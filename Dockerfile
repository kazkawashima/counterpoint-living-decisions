# syntax=docker/dockerfile:1.7

FROM node:24.15.0-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/adapters-cloudflare/package.json packages/adapters-cloudflare/package.json
COPY packages/adapters-node/package.json packages/adapters-node/package.json
COPY packages/adapters-openai/package.json packages/adapters-openai/package.json
COPY packages/application/package.json packages/application/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/ports/package.json packages/ports/package.json
COPY packages/protocol/package.json packages/protocol/package.json

RUN npm ci

COPY tsconfig.base.json tsconfig.check.json tsconfig.json ./
COPY apps apps
COPY packages packages

RUN npm run build && npm prune --omit=dev

FROM node:24.15.0-bookworm-slim AS runtime

ENV DATABASE_PATH=/data/counterpoint.sqlite \
    HOST=0.0.0.0 \
    NODE_ENV=production \
    PORT=8787 \
    STORAGE_PATH=/data/artifacts

WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages ./packages

RUN mkdir -p /data/artifacts && chown -R node:node /data

USER node

EXPOSE 8787

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/ready').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "apps/server/dist/main.js"]
