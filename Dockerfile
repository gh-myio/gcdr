# =============================================================================
# GCDR API - Simple Docker Build
# =============================================================================

FROM node:20-alpine

WORKDIR /app

# Install wget for healthcheck
RUN apk add --no-cache wget

# Copy package files and install
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Copy docs and assets
COPY docs/openapi.yaml ./docs/

# Prune dev dependencies
RUN npm prune --production

# Environment
ENV NODE_ENV=production
ENV PORT=3015
ENV HOST=0.0.0.0

EXPOSE 3015

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3015/health || exit 1

# Start (no migrations - run manually if needed)
CMD ["node", "dist/app.js"]
