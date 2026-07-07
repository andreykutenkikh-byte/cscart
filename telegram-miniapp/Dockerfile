FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile

FROM deps AS build
WORKDIR /app
COPY . .
RUN corepack enable && pnpm build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV IMAGE_CACHE_DIR=/var/cache/dvkeramik-miniapp/images
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
COPY migrations ./migrations
RUN mkdir -p /var/cache/dvkeramik-miniapp/images
VOLUME ["/var/cache/dvkeramik-miniapp/images"]
EXPOSE 3001
CMD ["node", "server/index.js"]
