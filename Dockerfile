# syntax = docker/dockerfile:1

FROM node:20.18.0-slim AS base
WORKDIR /app
RUN corepack enable && yarn set version 4.9.2

# Build stage
FROM base AS build
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential git node-gyp pkg-config python-is-python3

# Copy package files
COPY .yarnrc.yml package.json yarn.lock ./

# Install all dependencies (using Yarn v4 syntax, skip lifecycle scripts)
RUN yarn install --immutable --mode=skip-build

# Copy source code
COPY . .

# Build the application
RUN yarn build

# Final stage - using full node image for production to avoid missing dependencies
FROM node:20.18.0-slim AS final

# Install runtime dependencies that might be needed
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Enable yarn
RUN corepack enable && yarn set version 4.9.2

# Copy package files and built application from build stage
COPY --from=build /app/package.json /app/yarn.lock /app/.yarnrc.yml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/lib ./lib
COPY --from=build /app/WAProto ./WAProto

# Create auth directory
RUN mkdir -p baileys_auth_info

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Expose port
EXPOSE 8080

# Start the application
CMD ["node", "lib/server.js"]