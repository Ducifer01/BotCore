# syntax=docker/dockerfile:1.6

FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN apt-get update && apt-get install -y --no-install-recommends \
		openssl \
		ca-certificates \
	&& rm -rf /var/lib/apt/lists/* \
	&& npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src

RUN apt-get update && apt-get install -y --no-install-recommends \
		openssl \
		ca-certificates \
	&& rm -rf /var/lib/apt/lists/* \
	&& npm prune --omit=dev

CMD ["node", "src/bot.js"]
