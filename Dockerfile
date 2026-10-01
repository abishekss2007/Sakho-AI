# syntax=docker/dockerfile:1

# Sakho production image for Google Cloud Run.
# Node 24 is the active LTS line; the tag is pinned and updated by Dependabot.
ARG NODE_IMAGE=node:24.21.0-bookworm-slim

# ---- dependencies: exact versions from the lockfile -------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- build: needs no Gemini key and no Google credentials -------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runtime: standalone server only, non-root ------------------------------
FROM ${NODE_IMAGE} AS runtime
LABEL org.opencontainers.image.title="Sakho" \
      org.opencontainers.image.description="Multilingual, voice-first assistant for rural women in India"
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    # Listen on all interfaces. Cloud Run overrides PORT at run time.
    HOSTNAME=0.0.0.0 \
    PORT=8080 \
    # Safe defaults: emergency help is demo unless the deployment says "live".
    SOS_MODE=demo

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 8080

# Used by `docker run` and local orchestration. Cloud Run uses its own probes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "server.js"]
