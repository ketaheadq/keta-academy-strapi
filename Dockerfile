# STAGE 1: Build
FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++ vips-dev

WORKDIR /opt/app
COPY package.json yarn.lock ./

RUN --mount=type=cache,target=/root/.yarn \
  yarn install --frozen-lockfile --network-timeout 100000 --registry https://registry.npmjs.org/

COPY . .
RUN yarn build

RUN --mount=type=cache,target=/root/.yarn \
  yarn install --production --frozen-lockfile --force --network-timeout 100000 --registry https://registry.npmjs.org/

# ---

# STAGE 2: Runtime
FROM node:20-alpine
RUN apk add --no-cache tini vips curl

RUN addgroup -g 1001 -S nodejs && adduser -S strapi -u 1001 -G nodejs
WORKDIR /opt/app

# Pre-create folders for instant ownership and logs
RUN mkdir -p .tmp database public/uploads && chown -R strapi:nodejs /opt/app

# Copy production dependencies
COPY --from=builder --chown=strapi:nodejs /opt/app/node_modules ./node_modules

# Copy the build artifacts from the builder's dist directory to the root
# This moves dist/config -> ./config, dist/src -> ./src, etc.
COPY --from=builder --chown=strapi:nodejs /opt/app/dist ./
COPY --from=builder --chown=strapi:nodejs /opt/app/package.json ./package.json

# If you have other folders like public, copy them too
COPY --from=builder --chown=strapi:nodejs /opt/app/public ./public

USER strapi
ENV NODE_ENV=production
EXPOSE 1337

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["yarn", "start"]
