# --- Build stage ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

# --- Runtime stage ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S appgrp && adduser -S appuser -G appgrp
COPY --from=deps /app/node_modules ./node_modules
COPY . .
USER appuser
EXPOSE 4001
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4001/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"
CMD ["node", "server.js"]
