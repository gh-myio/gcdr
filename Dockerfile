# =============================================================================
# GCDR API - Multi-stage Docker Build
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# -----------------------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# -----------------------------------------------------------------------------
# Stage 2: Builder
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source files
COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# -----------------------------------------------------------------------------
# Stage 3: Production
# -----------------------------------------------------------------------------
FROM node:20-alpine AS production

WORKDIR /app

# Install wget for healthcheck and create non-root user
RUN apk add --no-cache wget && \
    addgroup -g 1001 -S nodejs && \
    adduser -S gcdr -u 1001 -G nodejs

# Copy built application
COPY --from=builder --chown=gcdr:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=gcdr:nodejs /app/dist ./dist
COPY --from=builder --chown=gcdr:nodejs /app/package*.json ./

# Copy OpenAPI documentation
COPY --chown=gcdr:nodejs docs/openapi.yaml ./docs/

# Copy drizzle migrations (SQL files for manual migration if needed)
COPY --chown=gcdr:nodejs drizzle/migrations ./drizzle/migrations

# Copy database seed scripts (for admin/db UI)
COPY --chown=gcdr:nodejs scripts/db/seeds ./scripts/db/seeds

# Switch to non-root user
USER gcdr

# Expose port
EXPOSE 3015

# Environment
ENV NODE_ENV=production
ENV PORT=3015
ENV HOST=0.0.0.0

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3015/health || exit 1

# Start application
CMD ["node", "dist/app.js"]

# -----------------------------------------------------------------------------
# Stage 4: Development (optional, for local development)
# -----------------------------------------------------------------------------
FROM node:20-alpine AS development

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies
RUN npm ci

# Copy source files
COPY tsconfig.json ./
COPY src ./src

# Expose port
EXPOSE 3015

# Environment
ENV NODE_ENV=development
ENV PORT=3015

# Start with hot reload
CMD ["npm", "run", "dev"]
