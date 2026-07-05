FROM node:20-alpine

RUN addgroup -g 1001 -S gridwire && adduser -u 1001 -S gridwire -G gridwire
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

# Persisted state (which files have been ingested) lives here.
RUN mkdir -p /data && chown -R gridwire:gridwire /app /data
VOLUME ["/data"]
ENV STATE_FILE=/data/state.json

USER gridwire

# Internal health/readiness server (liveness: /healthz, readiness: /readyz).
ENV HEALTH_PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:8080/healthz || exit 1

CMD ["node", "src/index.js"]
