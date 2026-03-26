# ── Build stage ──
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --include=optional
COPY . .
RUN npm run build

# ── Production stage ──
FROM node:22-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --include=optional && npm cache clean --force

RUN apt-get purge -y python3 make g++ && apt-get autoremove -y

COPY --from=build /app/dist ./dist
COPY src ./src
COPY server.js .
COPY data/agents ./data/agents

RUN mkdir -p data/runs data/exports data/topics data/templates data/users data/documents logs \
    && chown -R node:node data logs

ENV NODE_ENV=production
ENV PORT=3000
ENV LOG_DIR=/app/logs

EXPOSE 3000

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
