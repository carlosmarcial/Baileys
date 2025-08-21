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

# Install all dependencies (using Yarn v4 syntax)
RUN yarn install --immutable

# Copy source code
COPY . .

# Build the application
RUN yarn build

# Final stage
FROM base AS final

# Install production dependencies only
COPY .yarnrc.yml package.json yarn.lock ./
RUN yarn workspaces focus --production

# Copy built application
COPY --from=build /app/lib ./lib
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/test-server.cjs ./test-server.cjs

# Create auth directory
RUN mkdir -p baileys_auth_info

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Expose port
EXPOSE 8080

# Start the application
CMD ["node", "server.ts"]