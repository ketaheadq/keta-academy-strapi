FROM node:20-alpine

RUN apk add --no-cache tini vips curl python3 make g++

WORKDIR /opt/app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN npm run build

RUN addgroup -g 1001 -S nodejs && \
  adduser -S strapi -u 1001 -G nodejs && \
  mkdir -p public/uploads .tmp database && \
  chown -R strapi:nodejs /opt/app

USER strapi
ENTRYPOINT ["/sbin/tini", "--"]
EXPOSE 1337
CMD ["npm", "run", "start"]
