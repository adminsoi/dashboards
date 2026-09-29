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
# Drop to the image's built-in unprivileged user (uid 1000). Nothing at runtime
# writes to disk, so this works with a read-only root filesystem.
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
