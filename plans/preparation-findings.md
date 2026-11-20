# Phase P findings

Date: 2026-11-20. Plan: `plans/milestone-1-chat-foundation.md`.

Spikes and full reports are on branch `prep/spikes` (commit `e954fe9`, worktree `../model-chat-studio-prep`):

- Spike code: `scripts/spikes/{nuxt,openrouter,deepseek}/`, `server/api/_spike/`, `server/utils/spike-*.ts`.
- Full reports with commands, output and source references: `scripts/spikes/reports/prep-{nuxt,openrouter,deepseek}.md`.

## What ran

- **Credentials:** none were available. No OpenRouter key, DeepSeek key, S3 bucket or GitHub OAuth app.
- **Runs with no credentials:** the untouched template (install, typecheck, dev boot), a Nuxt dev server with spike routes, a production build, PGlite, and a throwaway local PostgreSQL 16.
- **Runs that would need a key:** everything that calls OpenRouter, DeepSeek, S3 or GitHub. These were checked offline:
  - the package source was read;
  - each provider's `fetch` was replaced to record the exact request it sends;
  - responses built from the official docs were fed back through `streamText`.
- **Live calls made:** OpenRouter's keyless `/models` and `/endpoints`, and a keyless DeepSeek `/models` call, which answered 401.
- **Reruns:** the offline self-checks (`transport.ts`, `stream.ts`, `stt.ts`, `glue.ts`, `rest.ts`) passed again after the agents finished.

## Results

| # | Assumption | Result | Main consequence |
|---|---|---|---|
| 1 | Template installs, typechecks, boots | **Partly.** Install and boot work. Typecheck fails with 4 errors (6 before `@types/node`). | Phase 0 fixes them |
| 2 | `hub:db` replaces `@nuxthub/db` | **Confirmed.** It is an alias of the same module. | none |
| 3 | PGlite applies identity, jsonb, uuid, self FK, numeric | **Confirmed**, on PGlite and on Postgres 16. Caveats below. | Production database setup changes |
| 4 | `nuxt-authorization` works with `nuxt/server` | **Fallback needed.** It works at runtime, fails the types, and lets requests through when it should deny them. | Replace `authorize()` with a wrapper |
| 5 | `nuxt-auth-utils` works with `nuxt/server` | **Confirmed.** 0.6.2 is built on `nuxt/server`. The full GitHub login is blocked. | `NUXT_SESSION_PASSWORD` is gone |
| 6 | `nuxt-security` CSRF works with installed h3 | **Confirmed with caveats.** It turns on `nuxt-csurf`. h3 is already 1.15.11, so no pin is needed. | Protect DELETE; drop the prerender rule |
| 7 | `deriveSecret()` usable for key encryption | **Confirmed.** AES-GCM round-trips and survives a restart. | Rotating the secret loses stored keys |
| 8 | AI SDK transport sends only the new message | **Confirmed with caveats.** | Server sets message ids; cost is read from `finish-step` |
| 9 | `blob.handleUpload()` with `nuxt/server` event | **Works, but not safe as-is.** | Manual upload path, safe serving |
| 10 | NuxtHub S3 driver config | **Confirmed offline. Fallback needed.** The live bucket is blocked. | Build the S3 storage at runtime |
| 11 | OpenRouter `provider.only` identifier | **Confirmed:** the endpoint `tag`. The live request is blocked. | Show the provider name, send the tag |
| 12 | OpenRouter web search | **Confirmed with a caveat.** The live call is blocked. | `openrouter:web_search` server tool |
| 13 | `@ai-sdk/deepseek` web search and effort | **Fallback needed.** Effort is native; the chatbot web search tool is not supported. | About 40 lines of glue (below) |
| 14 | DeepSeek cache-hit tokens reach the AI SDK | **Confirmed offline.** The live call is blocked. | Full cache-aware cost |
| 15 | Browser WAV accepted by both speech-to-text APIs | **Request format confirmed offline.** Acceptance is blocked on both keys. | Direct `fetch` on both platforms |
| 16 | PDF and CSV per platform | **OpenRouter PDF confirmed offline. CSV and DeepSeek PDF need fallbacks.** | Different paths per media type |

## Findings that affect security

1. **`nuxt-authorization` lets requests through when it should deny them (row 4).**
   - Its server `authorize()` catches every error and rethrows only its own `AuthorizationError` (`dist/runtime/server/utils/bouncer.js`). An ability or user lookup that throws therefore passes authorization.
   - The guest guard checks `user === null`, but this repo's resolver returns `undefined` for a guest. So an ability without `allowGuest` still lets guests through.
   - Both were reproduced at runtime.
   - This affects every `authorize()` call in `server/utils/core/useServerUsers.ts` today.
   - Fix (spiked in `server/utils/spike-authz.ts`): a wrapper that turns `undefined` into `null`, calls the non-swallowing `authorize` from `nuxt-authorization/utils`, and returns other errors as 500.
2. **Secrets are written into the build output.**
   - If `DATABASE_URL` is set while building, the URL and password become a string literal in the bundle. If it is unset, the build silently falls back to PGlite.
   - The auto-detected S3 driver writes `S3_SECRET_ACCESS_KEY` into the bundle and never reads runtime env.
3. **Uploads.**
   - `handleUpload` stores files under the filename the client sent.
   - It turns type and size rejections into 500.
   - Files are served without `Content-Disposition`, so an uploaded `.html` or `.svg` would render on the app's own origin.
4. **OAuth redirect URL.** Without `NUXT_OAUTH_GITHUB_REDIRECT_URL`, the GitHub `redirect_uri` is built from the request's `Host` header and an `X-Forwarded-Proto` it always trusts.
5. **CSRF gaps.**
   - DELETE is not protected by default.
   - The prerendered `/` page carries no CSRF token, so mutations from it fail.

## Plan changes forced by the findings

These are now in the milestone plan, together with the checkpoint answers at the end of this file. One detail changed on the way: the S3 variables are `NUXT_S3_*` rather than `S3_*`, so NuxtHub's auto-detected driver never picks them up.

### Section 2, conventions

- **`defineHandler` does not exist in `nuxt/server` 4.6.4**, which exports only `defineEventHandler`. I took it from docs written for a later version. Fixed in the plan already.
- `getRouterParam` returns percent-encoded values; pass `{ decode: true }`.
- Numeric columns come back as strings; convert them explicitly in budget and cost math.
- Handlers use the authorization wrapper from row 4, never the module's `authorize`, `allows` or `denies`.

### Section 3, inference layer

**OpenRouter:**
- Routing goes in `providerOptions.openrouter.provider`. `only` and `order` take endpoint **tags** (`deepinfra/fp4/flex`).
  - A bare slug such as `deepinfra` does not match tier endpoints (`/flex`, `/priority`), so send the exact tag the user picked.
  - The provider that served the turn comes back as a display name (`"DeepInfra"`) in `providerMetadata.openrouter.provider`.
- Cost is in `providerMetadata.openrouter.usage.cost` on the `finish-step` part. Drop `usage: { include: true }`; OpenRouter has deprecated it and always includes usage.
- Web search: `openrouter.tools.webSearch({})`.
  - The helper flattens options to the top level, while the docs nest them under `parameters`. If options are needed, pass `{ parameters: {...} }` with a cast.
  - Set `sendSources: true`, otherwise citations never reach the client.
- Keep `reasoning_details` on stored reasoning parts and send them back on later turns.
- Speech to text: direct `fetch` to `POST /api/v1/audio/transcriptions` with `input_audio: { data, format: 'wav' }`.
  - Per the docs, the response includes `usage.cost`.
  - Speech-to-text models are listed only by `/models?output_modalities=transcription`.
- PDFs work on every model, so don't gate them by input modality. Set the `file-parser` plugin to `cloudflare-ai` (free); the default `mistral-ocr` is billed per page.

**DeepSeek:**
- Keep `@ai-sdk/deepseek` on the Chat Completions protocol (`.chat()`). The spike compared four alternatives, each worse; the full report has the comparison.
- Add the glue, prototyped in `scripts/spikes/deepseek/glue.ts`:
  - A `fetch` wrapper that injects `deepseek_web_search`, `deepseek_read_url`, `safety_check` and `title`. The provider silently drops all four.
  - A middleware that turns citations into `source` parts and the title into metadata.
- Never use `deepSeek.tools.webSearch()`. It sends the Responses API's `web_search` tool, which only `deepseek-v4-pro` supports.
- Thinking and effort use native options. Levels are `none` (thinking off) plus the model's `effort.supported_levels`.
- Pass `userId` per user. DeepSeek uses it to isolate content safety and caching per user.
- Speech to text: direct `fetch` to `/v1/tools/asr` (multipart, at most 120 s and 8 MiB). Cost is `ceil(duration_ms / 1000)` seconds at the list price.
  - Record at 16 kHz; 120 s of 48 kHz audio is 11.5 MB, over the limit.
  - Reject over-limit clips before the call so they are not billed.
  - `@ai-sdk/deepseek` has no speech support, as you said.
- Reasoning must be sent back whenever tools are declared, otherwise DeepSeek returns 400. The chart tool is always declared, so stored reasoning parts must never be stripped.
- With `safety_check`, `title` or the web tools on, DeepSeek ignores `temperature` and `top_p`. Hide both on this platform.
- Web search, images and PDFs are documented for `deepseek-flash` only. Gate them per model.

**Shared:**
- Add to `CatalogModel`: `reasoning: { mandatory, defaultEnabled } | null`, `defaultReasoningLevel`, and `pricing.cacheRead`.
- Prices from OpenRouter arrive in USD per token; multiply by 1e6 for per 1M tokens.

### Section 4, schema

- `file`: add the cached DeepSeek `file_id`, its expiry, and a hash of the key it was uploaded with. A file id belongs to one DeepSeek account, so a user's own key cannot use an id uploaded with the instance key.
- `usageEvent.kind`: add `parse` for PDF parsing on DeepSeek. Its cost is null unless pages are counted locally.
- `userApiKey.ciphertext`: start with a key-version byte so the app secret can be rotated later.

### Section 5, API and one turn

- Server-generated message ids. `toUIMessageStream` needs `generateMessageId`, otherwise the stored assistant message has an empty id. Message ids sent to the client must be the database ids, because an edit refers to them.
- The client always sends `regenerate({ messageId })`. When the server gets no id, it treats the request as regenerating the last assistant message.
- Step 8, titles:
  - OpenRouter: a separate title call in parallel.
  - DeepSeek: the `title` flag on the first turn, which is free and arrives at the end of the stream. If none arrives, use the start of the user message.
- A DeepSeek answer that ends in `content-filter` is replaced by a refusal notice, and that notice is what gets stored.
- File uploads:
  - Read with `event.req.formData()`, check with `ensureBlob()` (which answers 400), store with `blob.put()` under `<userId>/<chatId>/<uuid>.<ext>`. The original name lives only in the `file` row.
  - Serve with `Cache-Control: private`. Send `Content-Disposition: attachment` for anything that is not an allowed image or PDF type.
- Attachments by media type:

| Type | OpenRouter | DeepSeek |
|---|---|---|
| Images | inline, when the model accepts images | inline, `deepseek-flash` only |
| PDF | inline, any model | uploaded to `/files` once, referenced by `file_id`, `deepseek-flash` only |
| CSV and other text | decoded on the server, sent as text | decoded on the server, sent as text |

- Delete blobs one at a time. The S3 driver's batch delete sends no `Content-MD5`, which AWS requires.

### Section 6, access control

- An ability that must answer 404 to guests needs `allowGuest: true` and must return `deny({ statusCode: 404 })` itself. Without `allowGuest`, guests get 403 before the ability runs.
- CSRF: `security.csrf.methodsToProtect` adds `DELETE`.
  - The chat transport and uploads send the `csrf-token` header.
  - The `/` prerender rule goes, since a prerendered page has no token.
- Production sets `NUXT_OAUTH_GITHUB_REDIRECT_URL`.

### Section 9, environment and deploy

- `NUXT_SESSION_PASSWORD` is not used; `NUXT_APP_SECRET` seals sessions and derives the encryption key.
  - Rotating it logs everyone out and makes stored personal keys unreadable.
  - In dev, set it in `.env`. Otherwise deleting `.nuxt` orphans the encrypted keys in the dev database.
- Database:
  - Production builds set `hub.db.driver: 'postgres-js'` and keep `DATABASE_URL` out of the build environment; it is supplied only at runtime.
  - Migrations run with `DATABASE_URL=… npx nuxt db migrate` before starting the server. There is no runtime migration, and statements run without a transaction.
- S3: build the blob storage at runtime from `@nuxthub/core/blob` and its S3 driver, which are public exports. Keep the `fs` driver for dev.
  - With `S3_ENDPOINT` plus `S3_BUCKET`, the driver uses path-style URLs, which suits MinIO, Backblaze and R2.
  - AWS needs an explicit `S3_REGION`.
- Add `NUXT_OAUTH_GITHUB_REDIRECT_URL`.

### Section 8, phases

- Phase 0 gains: fix the four baseline typecheck errors; replace `authorize()` with the wrapper; return `null` for guests in the resolver.
- Phase 3 gains the DeepSeek glue and per-model capability gating.
- Phase 7 gains the DeepSeek PDF upload flow.

## Blocked live checks

Run these once the credential exists. Each prints what to look for.

| Credential | Rows | Command (in `../model-chat-studio-prep`) |
|---|---|---|
| OpenRouter key | 11, 12, 15, 16 | `OPENROUTER_API_KEY=… bun scripts/spikes/openrouter/live.ts` |
| DeepSeek key | 13, 14 | `DEEPSEEK_API_KEY=… AI_SDK_LOG_WARNINGS=false bun scripts/spikes/deepseek/glue.ts --live` |
| DeepSeek key | 15, 16, catalog | `DEEPSEEK_API_KEY=… bun scripts/spikes/deepseek/rest.ts --live`, plus the two PDF `curl` calls in `prep-deepseek.md` |
| S3 bucket | 10 | `S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=… S3_BUCKET=… S3_REGION=… [S3_ENDPOINT=…] bun scripts/spikes/nuxt/s3-live.ts` |
| GitHub OAuth app | 5 | callback `http://localhost:3101/api/_spike/session/github`, then the steps in `prep-nuxt.md` row 5 |

The DeepSeek check also settles one unknown. The docs are ambiguous on whether the chart function tool can be declared together with the web tools, `title` and `safety_check`. If it cannot, the chart tool is dropped on DeepSeek turns that use web search.

## Checkpoint: answered 2026-11-20

The answers are folded into `plans/milestone-1-chat-foundation.md`.

| # | Question | Answer |
|---|---|---|
| 1 | Removals in section 7 | Approved |
| 2 | Moderators list, ban and unban only; promote and demote are admin only | Approved |
| 3 | Who can read a private chat | Nobody but the owner, unless shared. Sharing works like Google Docs: listed people in the instance, or anyone with the link. Admins get no access. |
| 4 | Admin bootstrap | Numeric GitHub id, in `NUXT_ADMIN_GITHUB_IDS`. Look one up with `curl -s https://api.github.com/users/<login> \| jq .id`. |
| 5 | Self-service profile edit removed | Approved |
| 6 | S3 credentials | They go in `.env`. The storage is built at runtime from `NUXT_S3_*`, so they never enter the build output. |
| 7 | Automatic migrations in dev | Approved |
| 8 | DeepSeek safety check | An admin setting, off by default, with a warning that explains its effects |
| 9 | DeepSeek PDFs | Included, through DeepSeek's file parsing flow (upload to `/files`, reference by `file_id`) |

On answer 9: the workaround named in the original question is on the AI SDK side, not DeepSeek's. DeepSeek's documented flow is used as written. `@ai-sdk/deepseek` drops PDF parts, so the adapter passes the `file_id` through the provider's image-reference path, which emits exactly DeepSeek's `{ "type": "file", "file_id": … }` block.

## Changes after the checkpoint (2026-11-20)

- **Admin bootstrap.** Answer 4 is replaced: the first person to sign up becomes admin. Numeric GitHub ids were too awkward to look up.
- **Inference platform.** The active platform and its instance key are admin settings in the dashboard, swappable there, instead of environment variables.
- **OAuth redirect URL.** `NUXT_OAUTH_GITHUB_REDIRECT_URL` is optional, not required. The callback URL is built from the request, and GitHub rejects one that does not match the OAuth app, so the header finding in "Findings that affect security" has little practical effect. The variable only matters behind a proxy that does not pass the public host and protocol through.

## Leftovers in the prep worktree

- Spike routes, a spike table and migration `0001_spike` live only on `prep/spikes`.
- Test data in `.data/` is not committed.
- Nothing is running.
- Remove it all with `git worktree remove ../model-chat-studio-prep` and `git branch -D prep/spikes` once the live checks are done.
