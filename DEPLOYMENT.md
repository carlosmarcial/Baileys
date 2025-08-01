# Baileys Deployment Guide for Koyeb

This guide explains how to deploy the Baileys WhatsApp API as a web service on Koyeb.

## Architecture

This deployment wraps the Baileys library in an Express.js server that provides REST API endpoints for WhatsApp operations.

## Deployment Steps

1. **Install Dependencies**
   ```bash
   yarn install
   ```

2. **Build the Project**
   ```bash
   yarn build
   ```

3. **Deploy to Koyeb**
   - Push your code to a Git repository (GitHub, GitLab, etc.)
   - Connect your repository to Koyeb
   - Koyeb will automatically detect the `Procfile` and use the command: `web: node lib/server.js`

## API Endpoints

### Health Check
- `GET /health` - Returns server and WhatsApp connection status

### Connection Management
- `GET /status` - Get current connection status
- `GET /qr` - Get QR code for authentication (when available)
- `POST /pairing-code` - Request pairing code
  ```json
  {
    "phoneNumber": "1234567890"
  }
  ```

### Messaging
- `POST /send-message` - Send text message
  ```json
  {
    "jid": "1234567890@s.whatsapp.net",
    "message": "Hello, World!"
  }
  ```

- `POST /send-media` - Send media message
  ```json
  {
    "jid": "1234567890@s.whatsapp.net",
    "mediaUrl": "https://example.com/image.jpg",
    "caption": "Check this out!",
    "mediaType": "image"
  }
  ```

## Environment Variables

Set these in your Koyeb service configuration:

- `PORT` - Server port (Koyeb provides this automatically)
- `USE_PAIRING_CODE` - Set to `true` to use pairing code instead of QR
- `PHONE_NUMBER` - Your phone number for pairing code authentication

## Authentication

The service supports two authentication methods:

1. **QR Code**: Default method. Call `GET /qr` to get the QR code and scan with WhatsApp
2. **Pairing Code**: Set `USE_PAIRING_CODE=true` and call `POST /pairing-code` with your phone number

## Persistent Storage

Authentication credentials are stored in the `baileys_auth_info` directory. For production, consider:
- Using Koyeb's persistent volumes
- Implementing cloud storage (S3, etc.)
- Using a database for credential storage

## Monitoring

- Check `/health` endpoint for service status
- Monitor Koyeb logs for WhatsApp connection events
- Set up alerts for disconnection events

## Security Considerations

1. **API Authentication**: Add API key authentication to protect endpoints
2. **Rate Limiting**: Implement rate limiting to prevent abuse
3. **HTTPS**: Koyeb provides HTTPS by default
4. **Environment Variables**: Store sensitive data in Koyeb environment variables

## Troubleshooting

1. **Connection Issues**: Check logs for WhatsApp connection errors
2. **Build Failures**: Ensure all dependencies are properly listed in package.json
3. **Runtime Errors**: Monitor Koyeb logs for detailed error messages

## Local Development

Run locally with:
```bash
yarn dev
```

This starts the server with hot reloading for development.