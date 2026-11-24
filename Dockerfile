# syntax=docker/dockerfile:1
# Bun installs and builds; Node runs the server.
#   docker build -t model-chat-studio .
#   docker run -p 3000:3000 --env-file .env.prod model-chat-studio
# The build needs no environment and the image holds no secrets: everything is read when the server starts.

FROM node:24-slim AS build
COPY --from=oven/bun:1.4.5 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
# `postinstall` runs `nuxt prepare`, which needs the sources; `nuxt build` prepares anyway.
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN node_modules/.bin/nuxt build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.output .output
# Files go here when no S3 bucket is configured; mount a volume on it to keep them.
RUN mkdir .data && chown node:node .data
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
