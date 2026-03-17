# STAGE 1: Build dependencies and admin panel
FROM node:20-bookworm-slim AS build

# Install build tools only needed for compilation
RUN apt-get update && apt-get install -y \
  build-essential \
  libvips-dev \
  python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .
RUN yarn build

# STAGE 2: Lightweight Runtime
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
  tini \
  libvips-dev \
  && rm -rf /var/lib/apt/lists/*

# Create user and set permissions
RUN groupadd -g 1001 nodejs && \
  useradd -m -u 1001 -g nodejs strapi

WORKDIR /opt/app

# Copy ONLY the production-ready files from the build stage
COPY --chown=strapi:nodejs --from=build /opt/app/node_modules ./node_modules
COPY --chown=strapi:nodejs --from=build /opt/app/public ./public
COPY --chown=strapi:nodejs --from=build /opt/app/build ./build
COPY --chown=strapi:nodejs --from=build /opt/app/package.json ./package.json
COPY --chown=strapi:nodejs --from=build /opt/app/dist ./dist
# Note: include /dist if you are using Strapi 5/TypeScript

USER strapi
ENV NODE_ENV=production
EXPOSE 1337

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["yarn", "run", "start"]
