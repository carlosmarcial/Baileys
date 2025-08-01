# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Baileys is a TypeScript/JavaScript WebSocket library for interacting with the WhatsApp Web API. It enables bots and automation without requiring Selenium or browser automation.

## Essential Commands

### Development
```bash
# Install dependencies (uses Yarn v4)
yarn install

# Run example script to test connection
yarn example

# Run example with pairing code instead of QR
yarn example --use-pairing-code

# Run TypeScript file directly
tsx path/to/file.ts
```

### Build & Type Checking
```bash
# Build the library
yarn build

# Run linting
yarn lint

# Fix linting issues  
yarn lint:fix

# Type checking (part of lint)
yarn lint
```

### Testing
```bash
# Run tests
yarn test

# Test files should match pattern: src/Tests/test.*.ts
```

### Protocol & Documentation
```bash
# Generate protobuf statics (after WAProto changes)
yarn gen:protobuf

# Build documentation
yarn build:docs
```

## Architecture Overview

### Core Structure
The codebase follows a layered socket architecture where each layer adds functionality:

1. **Base Socket** (`src/Socket/socket.ts`) - WebSocket connection, auth, and message handling
2. **Message Layer** (`src/Socket/messages-*.ts`) - Sending/receiving messages  
3. **Chat Layer** (`src/Socket/chats.ts`) - Chat operations (mute, archive, etc.)
4. **Group Layer** (`src/Socket/groups.ts`) - Group management
5. **Business Layer** (`src/Socket/business.ts`) - Business features
6. **Communities Layer** (`src/Socket/communities.ts`) - Final layer exported as `makeWASocket`

### Key Components

- **WABinary** - Binary protocol encoding/decoding for WhatsApp's custom format
- **WAProto** - Protobuf definitions compiled from WhatsApp protocol
- **Signal** - Implementation of Signal protocol for E2E encryption
- **Types** - TypeScript type definitions for all data structures
- **Utils** - Helper functions for crypto, media handling, auth storage

### Important Patterns

1. **Event System**: Uses EventEmitter pattern with typed events via `sock.ev`
2. **Auth State**: Credentials stored separately from keys for security
3. **Message Retry**: External cache for retry counts to prevent loops
4. **Media Handling**: Streams preferred over buffers for memory efficiency

### Critical Considerations

- Node.js >=20.0.0 required (enforced by engine-requirements.js)
- Uses ESM modules (type: "module" in package.json)
- Peer dependencies (jimp, sharp, link-preview-js) are optional for specific features
- WebSocket events use a specific CB: pattern for callbacks
- Message keys must be properly tracked for read receipts and reactions

## Common Development Tasks

### Adding New Message Types
1. Update types in `src/Types/Message.ts`
2. Add encoding/decoding in `src/Utils/messages.ts`
3. Update sending logic in `src/Socket/messages-send.ts`

### Implementing New Socket Features
1. Add to appropriate layer (groups.ts, chats.ts, etc.)
2. Export through the socket chain
3. Add TypeScript types to `src/Types/`

### Debugging WebSocket Communication
1. Enable debug logging: `logger.level = 'debug'`
2. Monitor WebSocket frames in `sock.ws.on('CB:...')`
3. Check WABinary encoding/decoding for protocol issues