# ---- Build stage -----------------------------------------------------------
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock* package-lock.json* ./
RUN bun install --frozen-lockfile --ignore-scripts || bun install --ignore-scripts

COPY . .

# Vite bakes VITE_* at build time — must be ARG/ENV before `bun run build`.
# Runtime container env alone does NOT fix the browser bundle.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_DEPLOYMENT_MODE=onprem
ARG VITE_SHOW_MARKETING=false
ARG VITE_GA_MEASUREMENT_ID=
ARG VITE_GITHUB_REPO_URL=https://github.com/shazily/gridwirepub
ARG VITE_INGEST_EMAIL_DOMAIN=ingest.local
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_DEPLOYMENT_MODE=$VITE_DEPLOYMENT_MODE
ENV VITE_SHOW_MARKETING=$VITE_SHOW_MARKETING
ENV VITE_GA_MEASUREMENT_ID=$VITE_GA_MEASUREMENT_ID
ENV VITE_GITHUB_REPO_URL=$VITE_GITHUB_REPO_URL
ENV VITE_INGEST_EMAIL_DOMAIN=$VITE_INGEST_EMAIL_DOMAIN

# Build a Node server bundle (instead of the default edge target).
ENV NITRO_PRESET=node-server
RUN test -n "$VITE_SUPABASE_URL" && test -n "$VITE_SUPABASE_PUBLISHABLE_KEY" || \
  (echo "ERROR: pass VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY as docker build-args" && exit 1)
RUN bun run build

# ---- Runtime stage ---------------------------------------------------------
FROM node:20-alpine AS runtime
RUN addgroup -g 1001 -S gridwire && adduser -u 1001 -S gridwire -G gridwire
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Nitro node-server output
COPY --from=build /app/.output ./.output
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
RUN chown -R gridwire:gridwire /app

USER gridwire

EXPOSE 3000

# Liveness check — matches the readiness/liveness endpoints documented in DEPLOYMENT.md.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/public/health || exit 1

CMD ["node", ".output/server/index.mjs"]
