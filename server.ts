import express from 'express'
import { Boom } from '@hapi/boom'
import NodeCache from '@cacheable/node-cache'
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, useMultiFileAuthState } from './src/index.js'
import type { WASocket } from './src/index.js'
import P from 'pino'
import crypto from 'crypto'
import axios from 'axios'

const app = express()
app.use(express.json())

const logger = P({ timestamp: () => `,"time":"${new Date().toJSON()}"` })
logger.level = 'info'

// Webhook configuration
const WEBHOOK_CONFIG = {
    url: process.env.WEBHOOK_URL || 'https://a21e23209781.ngrok-free.app/api/whatsapp/webhook',
    secret: process.env.WEBHOOK_SECRET || 'e6cff8cd6752c81bb58718052175c4bfda4a3f7ea5ed13bd208d7473bc6157ab',
    events: ['message', 'status', 'qr', 'connected', 'disconnected']
}

// Session management
interface Session {
    id: string
    sock: WASocket | null
    qrCode: string | null
    status: string
    createdAt: Date
}

const sessions = new Map<string, Session>()

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
// Default session for backward compatibility
let sock: WASocket | null = null
let qrCode: string | null = null
let connectionStatus = 'disconnected'

// Webhook sending function
async function sendWebhook(event: string, data: any, sessionId: string = 'default') {
    try {
        const payload = {
            sessionId,
            event,
            data,
            timestamp: new Date().toISOString()
        }
        
        const signature = crypto
            .createHmac('sha256', WEBHOOK_CONFIG.secret)
            .update(JSON.stringify(payload))
            .digest('hex')
        
        await axios.post(WEBHOOK_CONFIG.url, payload, {
            headers: {
                'Content-Type': 'application/json',
                'x-webhook-signature': signature
            },
            timeout: 5000
        })
        
        logger.info({ event, sessionId }, 'Webhook sent successfully')
    } catch (error) {
        logger.error({ error, event, sessionId }, 'Failed to send webhook')
    }
}

// Initialize WhatsApp connection
async function initializeWhatsApp(sessionId: string = 'default') {
    const authFolder = sessionId === 'default' ? 'baileys_auth_info' : `baileys_auth_${sessionId}`
    const { state, saveCreds } = await useMultiFileAuthState(authFolder)
    const { version, isLatest } = await fetchLatestBaileysVersion()
    
    console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`)

    const socket = makeWASocket({
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

    // Create or update session
    const session: Session = {
        id: sessionId,
        sock: socket,
        qrCode: null,
        status: 'connecting',
        createdAt: new Date()
    }
    sessions.set(sessionId, session)
    
    // Update default socket for backward compatibility
    if (sessionId === 'default') {
        sock = socket
    }
    
    // Handle connection updates
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update
        
        if (qr) {
            session.qrCode = qr
            if (sessionId === 'default') {
                qrCode = qr
            }
            console.log('QR Code updated for session:', sessionId)
            await sendWebhook('qr', { qr }, sessionId)
        }
        
        if (connection === 'close') {
            session.status = 'disconnected'
            if (sessionId === 'default') {
                connectionStatus = 'disconnected'
            }
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut
            console.log('connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect)
            
            await sendWebhook('disconnected', { reason: lastDisconnect?.error }, sessionId)
            
            if (shouldReconnect) {
                setTimeout(() => initializeWhatsApp(sessionId), 3000)
            } else {
                sessions.delete(sessionId)
            }
        } else if (connection === 'open') {
            session.status = 'connected'
            session.qrCode = null
            if (sessionId === 'default') {
                connectionStatus = 'connected'
                qrCode = null
            }
            console.log('WhatsApp connection opened for session:', sessionId)
            await sendWebhook('connected', { sessionId }, sessionId)
        } else if (connection === 'connecting') {
            session.status = 'connecting'
            if (sessionId === 'default') {
                connectionStatus = 'connecting'
            }
        }
    })

    // Save credentials when updated
    socket.ev.on('creds.update', saveCreds)

    // Handle incoming messages
    socket.ev.on('messages.upsert', async (event) => {
        for (const m of event.messages) {
            if (!m.key.fromMe && m.message) {
                console.log('Received message:', JSON.stringify(m.message, null, 2))
                await sendWebhook('message', {
                    key: m.key,
                    message: m.message,
                    messageTimestamp: m.messageTimestamp,
                    pushName: m.pushName
                }, sessionId)
            }
        }
    })
    
    // Handle message status updates
    socket.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
            await sendWebhook('status', update, sessionId)
        }
    })
    
    return socket
}

// API Routes

// Session Management Routes

// Create a new session
app.post('/api/sessions/create', async (req, res) => {
    try {
        const { sessionId = `session_${Date.now()}` } = req.body
        
        if (sessions.has(sessionId)) {
            return res.status(409).json({ error: 'Session already exists' })
        }
        
        await initializeWhatsApp(sessionId)
        
        res.json({
            sessionId,
            status: 'initializing',
            createdAt: new Date().toISOString()
        })
    } catch (error) {
        console.error('Error creating session:', error)
        res.status(500).json({ error: 'Failed to create session' })
    }
})

// Get session QR code
app.get('/api/sessions/:sessionId/qr', (req, res) => {
    const { sessionId } = req.params
    const session = sessions.get(sessionId)
    
    if (!session) {
        return res.status(404).json({ error: 'Session not found' })
    }
    
    if (!session.qrCode) {
        return res.status(404).json({ error: 'No QR code available' })
    }
    
    res.json({ qr: session.qrCode })
})

// Get session status
app.get('/api/sessions/:sessionId/status', (req, res) => {
    const { sessionId } = req.params
    const session = sessions.get(sessionId)
    
    if (!session) {
        return res.status(404).json({ error: 'Session not found' })
    }
    
    res.json({
        sessionId,
        connected: session.status === 'connected',
        status: session.status,
        hasQR: session.qrCode !== null,
        createdAt: session.createdAt
    })
})

// Delete session
app.delete('/api/sessions/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params
        const session = sessions.get(sessionId)
        
        if (!session) {
            return res.status(404).json({ error: 'Session not found' })
        }
        
        if (session.sock) {
            await session.sock.logout()
        }
        
        sessions.delete(sessionId)
        
        res.json({ success: true })
    } catch (error) {
        console.error('Error deleting session:', error)
        res.status(500).json({ error: 'Failed to delete session' })
    }
})

// Send message (supports session-based sending)
app.post('/api/messages/send', async (req, res) => {
    try {
        const { sessionId = 'default', to, message, type = 'text' } = req.body
        
        if (!to || !message) {
            return res.status(400).json({ error: 'to and message required' })
        }
        
        const session = sessions.get(sessionId) || (sessionId === 'default' ? { sock, status: connectionStatus } : null)
        
        if (!session || !session.sock || session.status !== 'connected') {
            return res.status(503).json({ error: 'Session not connected' })
        }
        
        let messageContent: any
        if (type === 'text') {
            messageContent = { text: message }
        } else {
            return res.status(400).json({ error: 'Unsupported message type' })
        }
        
        const result = await session.sock.sendMessage(to, messageContent)
        res.json({ 
            success: true, 
            messageId: result?.key.id,
            sessionId 
        })
    } catch (error) {
        console.error('Error sending message:', error)
        res.status(500).json({ error: 'Failed to send message' })
    }
})

// Register webhook (for updating webhook URL dynamically)
app.post('/api/webhook/register', (req, res) => {
    try {
        const { url, secret } = req.body
        
        if (!url) {
            return res.status(400).json({ error: 'Webhook URL required' })
        }
        
        WEBHOOK_CONFIG.url = url
        if (secret) {
            WEBHOOK_CONFIG.secret = secret
        }
        
        res.json({ 
            success: true,
            webhook: {
                url: WEBHOOK_CONFIG.url,
                events: WEBHOOK_CONFIG.events
            }
        })
    } catch (error) {
        console.error('Error registering webhook:', error)
        res.status(500).json({ error: 'Failed to register webhook' })
    }
})

// Media upload endpoint
app.post('/api/media/upload', express.raw({ type: ['image/*', 'video/*', 'audio/*'], limit: '50mb' }), async (req, res) => {
    try {
        // In a real implementation, you would:
        // 1. Save the uploaded file
        // 2. Return a URL or ID that can be used to send the media
        // For now, we'll return a placeholder response
        
        res.json({
            success: true,
            mediaId: `media_${Date.now()}`,
            message: 'Media upload endpoint - implementation pending'
        })
    } catch (error) {
        console.error('Error uploading media:', error)
        res.status(500).json({ error: 'Failed to upload media' })
    }
})

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

// Legacy send message endpoint (backward compatibility)
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