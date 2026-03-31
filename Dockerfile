# Build stage: Install dependencies
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Runtime stage: Lean production image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Create app user for security (don't run as root)
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Copy node_modules from builder
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy application code
COPY --chown=nodejs:nodejs src ./src
COPY --chown=nodejs:nodejs package*.json ./

# Set user to nodejs
USER nodejs

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 7070) + '/manifest.json', (r) => { if (r.statusCode !== 200) throw new Error(r.statusCode) })"

# Expose port (default 7070, override with PORT env var)
EXPOSE 7070

# Start application
CMD ["node", "src/index.js"]
