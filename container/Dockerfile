FROM oven/bun:1-alpine

RUN apk add --no-cache git

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --production

COPY server.ts ./

EXPOSE 8788

CMD ["bun", "run", "server.ts"]
