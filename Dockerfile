# STAGE 1: Build
FROM node:22-alpine AS builder

WORKDIR /opt/app
COPY package.json yarn.lock .yarnrc ./

RUN --mount=type=cache,target=/root/.yarn \
  yarn install --frozen-lockfile --ignore-engines --network-timeout 100000 --registry https://registry.npmjs.org/

COPY . .
RUN yarn build

RUN --mount=type=cache,target=/root/.yarn \
  yarn install --production --frozen-lockfile --force --ignore-engines --network-timeout 100000 --registry https://registry.npmjs.org/

# ---

# STAGE 2: Runtime
FROM node:22-alpine
# fontconfig + DejaVu: sharp needs a font to render the text in question SVGs
RUN apk add --no-cache tini curl fontconfig font-dejavu

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

# Copy root-level assets required at runtime
COPY --from=builder --chown=strapi:nodejs /opt/app/favicon.png ./favicon.png

USER strapi
ENV NODE_ENV=production
EXPOSE 1337

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["yarn", "start"]
