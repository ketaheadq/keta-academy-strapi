# STAGE 1: Dependencies (with build tools)
FROM node:20-alpine AS dependencies
RUN apk update && apk add --no-cache \
    build-base gcc autoconf automake python3 make g++ \
    cairo-dev jpeg-dev libpng-dev vips-dev pixman-dev \
    pango-dev giflib-dev zlib-dev
WORKDIR /opt/app
COPY package*.json ./
RUN npm ci

# STAGE 2: Builder
FROM node:20-alpine AS builder
WORKDIR /opt/app
COPY --from=dependencies /opt/app/node_modules ./node_modules
COPY . .
RUN npm run build

# STAGE 3: Production dependencies
FROM node:20-alpine AS production-dependencies
WORKDIR /opt/app
COPY package*.json ./
RUN npm ci --omit=dev

# STAGE 4: Production (final runtime image)
FROM node:20-alpine AS production
RUN apk add --no-cache vips curl && rm -rf /var/cache/apk/*

WORKDIR /opt/app
ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && adduser -S strapi -u 1001

COPY --from=production-dependencies /opt/app/node_modules ./node_modules
COPY --from=builder /opt/app/package*.json ./
COPY --from=builder --chown=strapi:nodejs /opt/app/dist ./dist
COPY --from=builder --chown=strapi:nodejs /opt/app/public ./public
COPY --from=builder --chown=strapi:nodejs /opt/app/config ./config

RUN mkdir -p /opt/app/public/uploads /opt/app/.tmp /opt/app/database && \
    chown -R strapi:nodejs /opt/app

USER strapi
EXPOSE 1337

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:1337/_health || exit 1

CMD ["npm", "run", "start"]