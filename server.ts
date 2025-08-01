import express from 'express'
import { Boom } from '@hapi/boom'
import NodeCache from '@cacheable/node-cache'
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, useMultiFileAuthState } from './src/index.js'
import type { WASocket } from './src/index.js'
import P from 'pino'

const app = express()
app.use(express.json())

const logger = P({ timestamp: () => `,"time":"${new Date().toJSON()}"` })
logger.level = 'info'

// Create a cache that implements the CacheStore interface
const msgRetryCounterCache = {
    cache: new NodeCache(),
    get<T>(key: string): T | undefined {
        return this.cache.get(key) as T | undefined
    },
    set<T>(key: string, value: T): void {
        this.cache.set(key, value)
    },
    del(key: string): void {
        this.cache.del(key)
    },
    flushAll(): void {
        // NodeCache doesn't have a clear method, so we'll create a new instance
        this.cache = new NodeCache()
    }
}
let sock: WASocket | null = null
let qrCode: string | null = null
let connectionStatus = 'disconnected'

// Initialize WhatsApp connection
async function initializeWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
    const { version, isLatest } = await fetchLatestBaileysVersion()
    
    console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`)

    sock = makeWASocket({
        version,
        logger,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        msgRetryCounterCache,
        generateHighQualityLinkPreview: true,
        printQRInTerminal: false,
    })

    // Handle connection updates
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update
        
        if (qr) {
            qrCode = qr
            console.log('QR Code updated')
        }
        
        if (connection === 'close') {
            connectionStatus = 'disconnected'
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut
            console.log('connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect)
            
            if (shouldReconnect) {
                initializeWhatsApp()
            }
        } else if (connection === 'open') {
            connectionStatus = 'connected'
            qrCode = null
            console.log('WhatsApp connection opened')
        } else if (connection === 'connecting') {
            connectionStatus = 'connecting'
        }
    })

    // Save credentials when updated
    sock.ev.on('creds.update', saveCreds)

    // Handle incoming messages
    sock.ev.on('messages.upsert', async (event) => {
        for (const m of event.messages) {
            if (!m.key.fromMe && m.message) {
                console.log('Received message:', JSON.stringify(m.message, null, 2))
            }
        }
    })
}

// API Routes

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        whatsapp: connectionStatus,
        timestamp: new Date().toISOString()
    })
})

// Get connection status
app.get('/status', (req, res) => {
    res.json({
        connected: connectionStatus === 'connected',
        status: connectionStatus,
        hasQR: qrCode !== null
    })
})

// Get QR code for authentication
app.get('/qr', (req, res) => {
    if (!qrCode) {
        return res.status(404).json({ error: 'No QR code available' })
    }
    res.json({ qr: qrCode })
})

// Request pairing code
app.post('/pairing-code', async (req, res) => {
    try {
        const { phoneNumber } = req.body
        
        if (!phoneNumber) {
            return res.status(400).json({ error: 'Phone number required' })
        }

        if (!sock) {
            return res.status(503).json({ error: 'WhatsApp not initialized' })
        }

        if (sock.authState.creds.registered) {
            return res.status(400).json({ error: 'Already registered' })
        }

        const code = await sock.requestPairingCode(phoneNumber)
        res.json({ code })
    } catch (error) {
        console.error('Error requesting pairing code:', error)
        res.status(500).json({ error: 'Failed to request pairing code' })
    }
})

// Send message
app.post('/send-message', async (req, res) => {
    try {
        const { jid, message } = req.body
        
        if (!jid || !message) {
            return res.status(400).json({ error: 'JID and message required' })
        }

        if (!sock || connectionStatus !== 'connected') {
            return res.status(503).json({ error: 'WhatsApp not connected' })
        }

        const result = await sock.sendMessage(jid, { text: message })
        res.json({ success: true, messageId: result?.key.id })
    } catch (error) {
        console.error('Error sending message:', error)
        res.status(500).json({ error: 'Failed to send message' })
    }
})

// Send media message
app.post('/send-media', async (req, res) => {
    try {
        const { jid, mediaUrl, caption, mediaType = 'image' } = req.body
        
        if (!jid || !mediaUrl) {
            return res.status(400).json({ error: 'JID and mediaUrl required' })
        }

        if (!sock || connectionStatus !== 'connected') {
            return res.status(503).json({ error: 'WhatsApp not connected' })
        }

        const mediaMessage: any = {
            caption
        }

        switch (mediaType) {
            case 'image':
                mediaMessage.image = { url: mediaUrl }
                break
            case 'video':
                mediaMessage.video = { url: mediaUrl }
                break
            case 'audio':
                mediaMessage.audio = { url: mediaUrl }
                break
            default:
                return res.status(400).json({ error: 'Invalid media type' })
        }

        const result = await sock.sendMessage(jid, mediaMessage)
        res.json({ success: true, messageId: result?.key.id })
    } catch (error) {
        console.error('Error sending media:', error)
        res.status(500).json({ error: 'Failed to send media' })
    }
})

// Start server
const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
    
    // Initialize WhatsApp connection on startup
    initializeWhatsApp().catch(console.error)
})

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing connections...')
    if (sock) {
        sock.logout()
    }
    process.exit(0)
})