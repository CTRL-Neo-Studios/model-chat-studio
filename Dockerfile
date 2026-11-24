# syntax=docker/dockerfile:1
# Bun installs and builds; Node runs the server.
#   docker build --secret id=env,src=.env.prod -t model-chat-studio .
#   docker run -p 3000:3000 --env-file .env.prod model-chat-studio

FROM node:24-slim AS build
COPY --from=oven/bun:1.4.5 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
# `postinstall` runs `nuxt prepare`, which needs the sources; `nuxt build` prepares anyway.
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
# The database and storage drivers are fixed at build time. The env file is mounted for this step only,
# so it stays out of the image layers (the build output still contains what it baked in).
RUN --mount=type=secret,id=env,target=/app/.env.prod,required=true bun run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.output .output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
