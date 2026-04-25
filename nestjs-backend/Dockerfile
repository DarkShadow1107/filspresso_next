# syntax=docker/dockerfile:1.7
FROM node:20-alpine@sha256:f598378b5240225e6beab68fa9f356db1fb8efe55173e6d4d8153113bb8f333c AS build

WORKDIR /app
COPY nestjs-backend/package*.json ./
RUN --mount=type=cache,target=/root/.npm apk add --no-cache python3 make g++ \
  && npm ci

COPY nestjs-backend/ ./
RUN npm run build \
  && npm prune --omit=dev

FROM node:20-alpine@sha256:f598378b5240225e6beab68fa9f356db1fb8efe55173e6d4d8153113bb8f333c

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

RUN apk add --no-cache dumb-init \
  && addgroup -S appgroup \
  && adduser -S appuser -G appgroup

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

COPY nestjs-backend/src/data/coffee.generated.json ./bootstrap-data/coffee.generated.json
COPY nestjs-backend/src/data/machines.generated.json ./bootstrap-data/machines.generated.json

RUN mkdir -p /tmp/filspresso /app/public/images \
  && ln -sfn /public/images /app/public/images \
  && chown -R appuser:appgroup /app /tmp/filspresso

USER appuser
EXPOSE 4000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
