# Model Chat Studio

A self-hosted AI chat for a small group of people. One instance serves its members, who sign in with GitHub by invitation or open signup, and chat with models from OpenRouter or DeepSeek.

The frontend is based on the [Nuxt UI chat template](https://github.com/nuxt-ui-templates/chat). The backend runs on PostgreSQL and S3-compatible storage.

> Work in progress. The plan and its current phase are in [`plans/milestone-1-chat-foundation.md`](plans/milestone-1-chat-foundation.md).

## Stack

- [Nuxt 4](https://nuxt.com) and [Nuxt UI](https://ui.nuxt.com)
- [NuxtHub](https://hub.nuxt.com) for PostgreSQL (Drizzle ORM) and file storage
- [nuxt-auth-utils](https://github.com/atinux/nuxt-auth-utils) for GitHub OAuth and sessions
- [AI SDK](https://ai-sdk.dev) with the OpenRouter and DeepSeek providers

## Setup

Install dependencies with [Bun](https://bun.sh):

```bash
bun install
```

Copy `.env.example` to `.env.dev` and fill it in. Every variable is described in that file. With `DATABASE_URL` and the storage variables unset, development uses a local PGlite database and local files under `.data/`.

The first person to sign up becomes the admin, so sign up yourself before sharing the address. The inference platform (OpenRouter or DeepSeek) and its API key are then set in the admin dashboard.

## Development

```bash
bun run dev          # http://localhost:3000, reads .env.dev
bun run lint
bun run typecheck
bun run test
```

## Database

```bash
bun run db:generate  # create a migration from server/db/schema.ts
bun run db:migrate   # apply pending migrations, reads .env.dev
```

## Production

Copy `.env.example` to `.env.prod`, then:

```bash
bun run build        # reads .env.prod
bun run preview      # serves the build locally
```

Two things to know before deploying:

- **The build output contains secrets.** The storage driver and its credentials are fixed when the app is built, and a `DATABASE_URL` present at build time is written into the bundle too. Treat `.output/` as secret and do not publish it or an image built from it.
- **Migrations do not run on their own.** Apply them with `DATABASE_URL=… bunx nuxt db migrate` before starting a new version.

The session cookie is `Secure`, so anything other than `localhost` needs HTTPS.

## Smoke runs

Against the platforms directly, with API keys:

```bash
OPENROUTER_API_KEY=… DEEPSEEK_API_KEY=… bun scripts/inference-smoke.ts        # turns, routing, search, platform switch
OPENROUTER_API_KEY=… DEEPSEEK_API_KEY=… bun scripts/attachments-smoke.ts     # image, PDF, speech to text
```

Through a running instance, as an admin (it switches the active platform for the run and back):

```bash
SESSION=<nuxt-auth-session cookie> BASE_URL=http://localhost:3000 bun scripts/app-smoke.ts [--search]
```

It runs, on each platform with an instance key: a turn, an image and a PDF, a regenerate, dictation, the spend ledger, and deleting the chat. `--search` adds a web search turn (about $0.02 on OpenRouter). The test files are made with macOS tools; elsewhere pass `--wav`, `--image` and `--pdf`.

## Limits

- Each member can request 20 answers and 20 transcriptions a minute; one address can make 600 requests a minute in total. The counters live in the server process.
- Attachments are at most 8 MB, recordings at most 2 minutes.
