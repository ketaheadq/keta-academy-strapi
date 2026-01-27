# Stage 4: Final Production Image
FROM node:20-alpine AS production
# Use vips (runtime) instead of vips-dev (development)
RUN apk add --no-cache vips curl libpng zlib

WORKDIR /opt/app
ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && adduser -S strapi -u 1001

# Copy pruned node_modules and built files
COPY --from=builder /opt/app/package*.json ./
COPY --from=builder /opt/app/node_modules ./node_modules
COPY --from=builder --chown=strapi:nodejs /opt/app/dist ./dist
COPY --from=builder --chown=strapi:nodejs /opt/app/public ./public
COPY --from=builder --chown=strapi:nodejs /opt/app/config ./config

# Create necessary persistent directories
RUN mkdir -p /opt/app/public/uploads /opt/app/.tmp /opt/app/database && \
    chown -R strapi:nodejs /opt/app

USER strapi
EXPOSE 1337

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:1337/_health || exit 1

CMD ["npm", "run", "start"]