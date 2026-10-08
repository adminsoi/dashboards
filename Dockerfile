FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# The RFQ task store lives here, on a volume. Creating it owned by `node` means
# a fresh named volume inherits that ownership. Everything else stays read-only.
RUN mkdir -p /data && chown node:node /data
ENV TASKS_DATA_DIR=/data
# Drop to the image's built-in unprivileged user (uid 1000).
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
