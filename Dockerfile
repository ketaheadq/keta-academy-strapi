# Stage 1: Base - Setup env and workspace
FROM node:20-alpine AS base
RUN apk update && apk add --no-cache build-base gcc autoconf automake zlib-dev libpng-dev vips-dev > /dev/null 2>&1
RUN npm install -g npm@latest
WORKDIR /opt/app

# Stage 2: Dependencies - Build everything here
FROM base AS builder
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 3: Development - For local development with hot-reload
FROM base AS development
ENV NODE_ENV=development
COPY --from=builder /opt/app/node_modules ./node_modules
COPY . .
ENV PATH /opt/app/node_modules/.bin:$PATH
RUN chown -R node:node /opt/app
USER node
EXPOSE 1337
CMD ["npm", "run", "develop"]

# Stage 4: Final Production Image
FROM node:20-alpine AS production
# Install runtime shared libraries and curl for healthcheck
RUN apk add --no-cache vips-dev curl
WORKDIR /opt/app
ENV NODE_ENV=production

# Security: Create a non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S strapi -u 1001

# Copy only production dependencies (pruned)
COPY --from=builder /opt/app/package*.json ./
COPY --from=builder /opt/app/node_modules ./node_modules
RUN npm prune --production && npm cache clean --force

# Copy only built application and necessary configs
COPY --from=builder --chown=strapi:nodejs /opt/app/dist ./dist
COPY --from=builder --chown=strapi:nodejs /opt/app/public ./public
COPY --from=builder --chown=strapi:nodejs /opt/app/config ./config
COPY --from=builder --chown=strapi:nodejs /opt/app/database ./database

# Create managed directories for volumes and set ownership
RUN mkdir -p /opt/app/public/uploads /opt/app/.tmp && \
    chown -R strapi:nodejs /opt/app/public/uploads /opt/app/.tmp

USER strapi

EXPOSE 1337
# Adding a basic healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:1337/_health || exit 1

CMD ["npm", "run", "start"]

