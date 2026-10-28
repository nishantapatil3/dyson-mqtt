FROM node:22-alpine
LABEL org.opencontainers.image.title="dyson-mqtt" \
      org.opencontainers.image.description="Cloud MQTT bridge for Dyson devices" \
      org.opencontainers.image.source="https://github.com/nishantapatil3/dyson-mqtt" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="0.1.3"
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN mkdir -p /app/data && chown node:node /app/data
USER node
CMD ["node", "src/server.js"]
