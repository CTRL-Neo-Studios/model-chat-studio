# Milestone 1: chat template frontend on an extended backend

Status: planned, nothing implemented. Written 2026-11-20. Work starts with phase P (preparation) and stops at the checkpoint that follows it; see section 8.

Goal: the Nuxt UI chat template's frontend (`../chat`, upstream `nuxt-ui-templates/chat` at `f00f2a6`) running in this repo on PostgreSQL and S3, with invite-gated GitHub signup, a platform-agnostic inference layer (OpenRouter or DeepSeek), model and upstream-provider selection, sampling parameters, usage accounting and quotas.

## 1. Decisions

| Topic | Decision |
|---|---|
| Identity | GitHub OAuth only. Logto is removed. |
| Signup | `invite` (link required), `open` (any GitHub account) or `closed`, set by an admin. |
| Admin bootstrap | GitHub logins listed in `NUXT_ADMIN_GITHUB_LOGINS` become admin on login and bypass the signup gate. |
| Access control | Session cookie for authentication, user row loaded per request, `nuxt-authorization` abilities for every decision. See section 6. |
| Anonymous use | None. The only anonymous read is a chat shared by public link. |
| Inference platform | One active platform per instance, chosen by env: `openrouter` or `deepseek`. All calls go through one adapter interface; rows record the platform so history survives a switch. |
| Keys | One instance key, plus an optional per-user key (encrypted) that overrides it. |
| Catalog | Live from the platform, filtered by an admin allowlist. An empty allowlist allows everything. |
| Quota | Monthly USD budget per user: instance default, per-user override, `null` means unlimited. Requests on a user's own key are exempt. |
| Multi-model | Schema-ready only (`message.parentId`, model and provider per message). The UI stays single-model. |
| Dictation | Record, then transcribe. Neither platform streams recognition, so the template's live preview is dropped. |
| Storage | NuxtHub blob with the S3 driver, private bucket. Files are served through an authenticated route and sent to models as bytes. |
| Database | Migration `0000` is regenerated; nothing is deployed. |
| Language | English strings only. `@nuxtjs/i18n` stays installed and untouched. |
| Demo tools | The chart tool is kept. The weather tool is dropped (it returns random data). |

## 2. Conventions

### Server code imports from `nuxt/server`

Every handler in `server/api` and `server/routes` imports explicitly from `nuxt/server`, including `defineHandler`. The auto-imported names of the same spelling are h3's and take a different event; mixing them raises `NUXT_E8012`.

```ts
import { createError, defineHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'

export default defineHandler(async (event) => {
	const id = getRouterParam(event, 'id')!
	const body = await readValidatedBody(event, z.object({ title: z.string().trim().min(1).max(100) }))
	if (!id) throw createError({ status: 404, statusText: 'Chat not found' })
	return { id, ...body }
})
```

Differences from the h3 v1 code currently in this repo:

| h3 v1 (current) | `nuxt/server` |
|---|---|
| `createError({ statusCode, statusMessage })` | `createError({ status, statusText })` |
| `sendRedirect(event, url)` sends | `return sendRedirect(event, url)` |
| `setResponseHeader(event, k, v)` | `event.res.headers.set(k, v)` |
| `getValidatedRouterParams(event, fn)` | `getRouterParam(event, name)` plus a zod parse |
| `readValidatedBody(event, schema.parse)` | `readValidatedBody(event, schema)` (Standard Schema) |
| `H3Event` type | `RequestEvent` type |
| `readMultipartFormData(event)` | `await event.req.formData()` (web standard) |
| client abort | `event.req.signal` |

A handler may return a `Response` or a `ReadableStream`, which is how the chat stream is returned.

Documented exceptions, because `nuxt/server` does not cover them:

- `server/plugins/authorization-resolver.ts` stays a Nitro plugin (`defineNitroPlugin` and the `request` hook are Nitro-only).
- Caching does not use `defineCachedFunction`. The catalog cache is a module-level `Map` with a TTL.
- Secrets use `deriveSecret(purpose)` from `nuxt/server`, so `NUXT_APP_SECRET` is the only secret to configure.

The existing eleven handlers under `server/api/v1` and both files in `server/utils/core` are migrated to this convention in phase 1.

### Other conventions

- Database access: `import { db, schema } from 'hub:db'` (the NuxtHub 0.10 form the template uses), replacing `@nuxthub/db`.
- API prefix: `/api/v1`. OAuth lives at `/auth/github` as a server route.
- Formatting: tabs, per `.editorconfig`. Ported template files are reformatted.
- Package manager: bun. Tests: `bun test`, no framework.

## 3. Inference layer

`server/utils/inference/` holds `types.ts`, `openrouter.ts`, `deepseek.ts` and `index.ts`. `useInference()` returns the adapter named by `runtimeConfig.inference.platform`.

```ts
export interface InferencePlatform {
	id: 'openrouter' | 'deepseek'
	capabilities: { providerRouting: boolean }
	listModels(apiKey: string): Promise<CatalogModel[]>
	listEndpoints?(apiKey: string, modelId: string): Promise<CatalogEndpoint[]>
	/** Everything `streamText` needs for one turn. */
	prepare(input: TurnInput): { model: LanguageModel, tools?: ToolSet, providerOptions?: ProviderOptions }
	/** Tokens, cost and the upstream provider that served the turn. */
	usage(result: TurnResult): TurnUsage
	transcribe(apiKey: string, wav: Blob): Promise<{ text: string, costUsd: number | null }>
}
```

`CatalogModel` is normalized: `id`, `name`, `vendor`, `contextLength`, `maxOutputTokens`, `inputModalities`, `supportedParameters`, `reasoningLevels`, `pricing` (USD per 1M tokens, optional).

| Capability | OpenRouter | DeepSeek |
|---|---|---|
| AI SDK provider | `@openrouter/ai-sdk-provider` 3.1 (peer `ai ^7`) | `@ai-sdk/deepseek` 3.0 |
| Catalog | `GET /api/v1/models` | `GET /models` |
| Upstream providers | `GET /api/v1/models/:id/endpoints`, sent as `provider: { only, allow_fallbacks }` | none; the picker is hidden |
| Cost | `providerMetadata.openrouter.usage.cost` with `usage: { include: true }` | tokens × price table below |
| Web search | OpenRouter server tool | `deepseek_web_search` server tool |
| Reasoning | `reasoning` provider option | `effort` levels from the catalog |
| Dictation | STT endpoint, model from the `sttModel` setting | `POST /v1/tools/asr`: WAV or Ogg, 120 s and 8 MiB max |

### DeepSeek prices

DeepSeek's `/models` carries no pricing and responses carry no cost, so the adapter ships a table from <https://api-docs.deepseek.com/quick_start/pricing> (read 2026-11-20), USD per 1M tokens:

| Model | Input, cache hit | Input, cache miss | Output |
|---|---|---|---|
| `deepseek-flash` | 0.006 peak, 0.003 off-peak | 0.30 peak, 0.15 off-peak | 1.20 peak, 0.60 off-peak |
| `deepseek-v4-pro` | 0.044 peak, 0.022 off-peak | 1.32 peak, 0.66 off-peak | 3.96 peak, 1.98 off-peak |

- Peak is 01:00–04:00 and 06:00–10:00 UTC, Monday to Friday. Chinese public holidays are off-peak; the adapter ignores them, which overcounts slightly and never undercounts.
- Speech to text is 0.116 per hour of audio at list price.
- Server-side search calls are billed as model tokens, so they need no separate line.
- Price resolution: admin override in `modelSetting`, else the table, else uncounted with a warning on the admin models page.

## 4. Schema

PostgreSQL through Drizzle `pgTable`, in `server/db/schema.ts`.

| Table | Columns of note |
|---|---|
| `user` | `id` uuid, `githubId` unique, `username`, `name`, `email`, `avatarUrl`, `role`, ban fields, `monthlyBudgetUsd` numeric null |
| `invite` | `codeHash` unique, `createdBy`, `maxUses`, `useCount`, `expiresAt`, `revokedAt` |
| `setting` | `key` PK, `value` jsonb: `signupMode`, `defaultModel`, `defaultMonthlyBudgetUsd`, `titleModel`, `sttModel` |
| `modelSetting` | PK (`platform`, `modelId`), `enabled`, `priceInput`, `priceCachedInput`, `priceOutput` (null means no override) |
| `userApiKey` | PK (`userId`, `platform`), `ciphertext` |
| `chat` | `id` uuid, `userId` FK cascade, `title`, `visibility`, `systemPrompt`, `params` jsonb |
| `message` | `id` text, `seq` identity, `chatId` FK cascade, `parentId` self FK null, `role`, `parts` jsonb, `metadata` jsonb |
| `vote` | PK (`chatId`, `messageId`), `isUpvoted` |
| `file` | existing columns plus `chatId` uuid (no FK), `messageId` FK null, `mediaType`, `size` |
| `usageEvent` | `userId`, `chatId` set null, `kind` (`chat`, `title`, `stt`), `platform`, `model`, `provider`, token counts, `costUsd`, `byok`, `createdAt` |

Reasons behind the shape:

- `message.seq` orders messages. The template orders by a second-precision timestamp, so messages saved in the same second can swap.
- `usageEvent` is append-only. Edit and regenerate delete message rows, so summing messages would refund spend.
- `message.metadata` carries `platform`, `model`, `provider`, tokens and cost for display. It is the AI SDK `UIMessage.metadata` field, sent with `messageMetadata`.
- `file.chatId` has no foreign key because the home page uploads before the chat row exists.
- `chat.params`: `model`, `providers`, `allowFallbacks`, `temperature`, `topP`, `maxOutputTokens`, `reasoningEffort`, `webSearch`. One zod schema in `shared/` validates it on both sides.

## 5. API surface

All under `/api/v1`, all requiring a user unless noted.

| Route | Purpose |
|---|---|
| `GET /chats`, `POST /chats` | list own chats; create with the first message |
| `GET /chats/:id` | read; allowed without login when the chat is public |
| `PATCH /chats/:id` | title, visibility, system prompt, params (one route instead of the template's two) |
| `DELETE /chats/:id` | delete the chat, its blobs and file rows |
| `POST /chats/:id` | stream a turn (see below) |
| `GET /chats/:id/votes`, `POST /chats/:id/votes` | as in the template |
| `GET /models` | catalog, allowlist applied, cached one hour |
| `GET /models/endpoints?id=` | upstream providers for one model (ids contain slashes, so a query parameter) |
| `PUT /files/:chatId`, `GET /files/:id`, `DELETE /files/:id` | upload, serve, delete |
| `POST /transcriptions` | WAV in, text out |
| `GET /users/me`, `GET /me/usage`, `PUT /me/api-key`, `DELETE /me/api-key` | profile, month spend against budget, personal key |
| `/users/**` | existing user management, migrated to `nuxt/server`, plus budget |
| `/admin/invites`, `/admin/settings`, `/admin/models` | admin only |
| `GET /auth/github` (server route) | OAuth callback and signup gate |

### One turn (`POST /chats/:id`)

1. Require the user, load the chat by owner, validate the body.
2. Check the model against the allowlisted catalog and the chosen providers against its endpoints.
3. Resolve the key: the user's key for the active platform, else the instance key.
4. On the instance key, compare this month's `usageEvent` sum with the budget. Over budget returns `402`.
5. Apply the trigger. `submit-message` saves the new user message; an edit truncates after it; `regenerate-message` truncates from the target. Truncation deletes the attached blobs first.
6. Build model messages from the database, swapping file parts for bytes from the blob store.
7. Call `streamText` with the adapter's `prepare()` output, the system prompt, the chart tool and `event.req.signal`.
8. Generate the title in parallel on the first turn and send it as a transient data part.
9. On finish, insert the assistant message with metadata and one `usageEvent` row.

Differences from the template, on purpose:

- The client sends only the new message. The template trusts the whole client-supplied history.
- Truncation happens inside the stream request. The template makes a separate delete call first.
- The title no longer blocks the first token.

Known ceilings:

- Two concurrent streams can overshoot a budget by one request.
- An aborted stream may report no usage and is then recorded with a null cost. The upgrade path on OpenRouter is the generation lookup endpoint.

## 6. Auth, signup and access control

### Signup flow

1. `/invite/[code]` validates the code, stores it in the sealed session and redirects to `/auth/github`.
2. `server/routes/auth/github.get.ts` uses `defineOAuthGitHubEventHandler` from `nuxt-auth-utils`.
3. A known `githubId` logs in, unless banned.
4. A new account is created when the login is in `NUXT_ADMIN_GITHUB_LOGINS`, signup is `open`, or the invite claim succeeds. The claim is one statement: `UPDATE invite SET useCount = useCount + 1 WHERE codeHash = ? AND useCount < maxUses AND not expired AND not revoked RETURNING id`.
5. Otherwise the user lands on `/signin?error=signup_closed`.

The session cookie carries `{ id, role, username, name, avatar }`. The server still reads role and ban state from the database on every request through the existing resolver.

### Access control

Three layers, all enforced on the server:

1. **Authentication.** The sealed session cookie from `nuxt-auth-utils`. The role inside the cookie only shows or hides UI.
2. **Identity per request.** The existing resolver plugin loads the user row by session id, so a ban or role change applies on the next request.
3. **Authorization.** `nuxt-authorization` abilities in `shared/abilities/`, the pattern `userAbilities.ts` already uses. A handler loads the resource, then calls `authorize(event, ability, resource)`. The client imports the same abilities only to hide controls.

Every ability starts with `satisfies(user)`, which rejects banned users. Abilities a guest may pass are declared with `allowGuest`. New files: `chatAbilities.ts`, `fileAbilities.ts`, `adminAbilities.ts`.

| Actor | Allowed |
|---|---|
| Guest | read a public chat and the files attached to it; `/signin`; `/invite/[code]` |
| User | own chats, messages, votes and files; the allowlisted catalog; own usage and API key |
| Moderator | list users; ban and unban users of lower role |
| Admin | everything a moderator can; promote, demote and delete users; budgets; invites; signup mode; model allowlist and prices |

Rules:

- A private chat and its files answer `404` to everyone but the owner. Admins get no access to other users' private chats.
- A role action applies only to a target of strictly lower role, and never to oneself.
- Three checks are policy rather than abilities and run on the server for every turn: the model allowlist, the provider list and the budget. The signup gate runs at account creation. Filtering in the client is cosmetic.
- API keys never leave the server. `GET /users/me` reports only whether a personal key is set.
- Mutations need the CSRF token. The stream and transcription routes are rate limited.

Fixes to rules that exist today:

- `demoteUser` and `banUser` compare no roles, so a moderator can demote or ban an admin. Both get the strictly-lower rule.
- `promoteUser` lets a moderator create moderators. Promote and demote become admin only.
- `editUserHandler` strips protected fields with a denylist and accepts an unvalidated body, so new columns such as `githubId` and `monthlyBudgetUsd` would be self-editable. `PATCH /users/:id` becomes admin only with a zod allowlist (`role`, `monthlyBudgetUsd`). Profile fields come from GitHub at login, so self-edit is removed.
- `banExpires` is stored but never read. `getBanned` in `shared/utils/roles.ts` treats an expired ban as lifted.
- `app/plugins/authorization-resolver.ts` reads `useUserSession().user` instead of `useAuthSession().user`.

Known ceiling: a demoted admin keeps seeing admin navigation until the session refreshes. Every admin request already fails with `403`.

## 7. Frontend

### Ported from the template

- `layouts/default.vue`, `pages/index.vue`, `pages/chat/[id].vue`, `middleware/transitions.global.ts`.
- `components/`: `Navbar`, `UserMenu`, `ModalConfirm`, `ModalRename`, and under `chat/`: `Prompt`, `PromptMenu`, `ChatTitle`, `ChatVisibility`, `DictateButton`, `Indicator`, `SourceLink`, `Comark.ts`, `message/*`, `tool/Chart`, `tool/Sources`.
- `composables/`: `useChats`, `useChatActions`, `useFileUpload`.
- `utils/`: `ai.ts`, `tool.ts`, `url.ts`; `shared/utils/file.ts`, `shared/utils/tools/chart.ts`.
- The template's CSS additions in `main.css`.

### Rewritten

- `useModels` and `ModelSelect`: catalog from `/models`, search, vendor groups, price, context length, modalities.
- `useChatSettings`: per-chat `params` saved with `PATCH /chats/:id` instead of cookies.
- `useDictation`: keeps the microphone capture and level meter, collects samples, encodes 16 kHz mono 16-bit WAV on stop and posts it. `SAMPLE_RATE` and `MAX_DURATION` stay as constants; 120 s is 3.84 MB, under the 8 MiB limit.
- `app/utils/tool.ts` `getSources()`: one case per platform's search result shape.

### New

- Provider picker beside the model picker: Auto or chosen providers, a fallback toggle, and price, quantization and uptime per endpoint. Rendered only when `capabilities.providerRouting` is true.
- Chat settings panel: system prompt, temperature, top-p, max output tokens, reasoning effort. Each control appears only if the model lists the parameter.
- Reply footer: model, provider, tokens, cost.
- `/signin` with the GitHub button and `/invite/[code]`.
- `/settings`: month usage against budget, personal API key.
- `/admin/users`, `/admin/invites`, `/admin/models`, `/admin/settings`.

### Removed from this repo

These are replaced by the port or made redundant by the session change. Veto any of them at the checkpoint in section 8.

- `server/api/v1/auth/logto.get.ts` and the Logto env vars.
- `app/components/Layout/Header.vue` and `app/components/Logo.vue` (it points at a missing `/logo.png`).
- `app/composables/core/useAuthSession.ts`, `useMe.ts` and both `session-prefetch` plugins. Template components call `useUserSession()` directly. `app/plugins/authorization-resolver.ts` is kept and rewired (section 6).
- The two named middlewares, replaced by one global `auth` middleware.
- `routeRules['/'].prerender`, since `/` becomes the signed-in chat home.
- `@vercel/blob`.

## 8. Phases

Phase P comes first and ends in a checkpoint: no later phase starts until you have answered it. After that, phases 2 and 3 are independent once phase 1 is done, and phases 7 and 8 are independent once phase 5 is done.

| # | Phase | Work | Done when |
|---|---|---|---|
| P | Preparation | Verify every assumption in section 10 on a throwaway branch; write `plans/preparation-findings.md` | every row in section 10 is confirmed, on its fallback, or reported blocked; **work stops for the checkpoint** |
| 0 | Groundwork | Add `ai`, `@ai-sdk/vue`, `@openrouter/ai-sdk-provider`, `@ai-sdk/deepseek`, `@comark/vue`, `shiki`, `@shikijs/langs`, `@tanstack/charts`, `date-fns`, `aws4fetch`, `@nuxt/eslint`, `eslint`. Add `lint`, `db:generate`, `db:migrate` scripts. Configure the S3 blob driver, CSRF through `nuxt-security`, `runtimeConfig.inference`. Rewrite `.env.example` and the README. | `bun run lint` and `bun run typecheck` pass; CI is green |
| 1 | Data and conventions | New schema, regenerated migration, existing handlers and utils moved to `nuxt/server` and `hub:db` | migration applies on PGlite and on a real Postgres; user routes still answer |
| 2 | Auth and access control | GitHub handler, invite flow, admin bootstrap, global auth middleware, abilities and rule fixes from section 6, removals from section 7 | invite claim test passes; a second use of a single-use invite is refused; a moderator cannot ban or demote an admin |
| 3 | Inference adapter | Both adapters, catalog cache, allowlist filter, key resolution and encryption, spike script | the spike streams one turn on each platform with routing, reasoning, web search and usage printed |
| 4 | Chat backend | Routes in section 5 except files and transcription; ledger and quota | ordering, quota and truncation tests pass; a turn streams through `curl` |
| 5 | Frontend port | Section 7 "Ported" on the new API | create, stream, edit, regenerate, vote, rename, delete and share work in the browser |
| 6 | Extended chat UI | Model and provider pickers, settings panel, reply footer | changing provider changes `metadata.provider` on the next reply |
| 7 | Files and dictation | File routes, bytes to the model, WAV dictation | an image reaches a vision model; a spoken sentence lands in the prompt on both platforms |
| 8 | Admin and settings | Admin pages, `/settings` | an admin can invite, ban, set a budget, disable a model and switch signup mode from the UI |
| 9 | Hardening | Rate limits on stream and transcription, CSP review, full smoke run per platform | smoke run passes on OpenRouter and on DeepSeek |

Tests kept small and pure where possible: invite claim, quota sum, message ordering, truncation, DeepSeek cost (peak window and cache split), and each adapter's option mapping.

### Phase P: preparation

Purpose: test the assumptions this plan rests on before any product code exists.

- **Where.** A throwaway branch, `prep/spikes`. Dependencies are installed and spike scripts live under `scripts/spikes/`. Only `plans/preparation-findings.md` comes back to the working branch.
- **Baseline first.** `bun install`, `nuxt prepare`, typecheck and a dev boot of the untouched template. None of these has been run yet.
- **Per assumption.** Result (confirmed, fallback taken, or blocked), the command and output that show it, and any change it forces on this plan.
- **Credentials.** Rows in section 10 marked with a key need an OpenRouter key, a DeepSeek key, an S3 bucket or a GitHub OAuth app. Rows that need nothing run first. A row whose credential is missing is reported as blocked, not guessed.

### Checkpoint

After phase P, work stops. You get the findings, the plan changes they force, and these open decisions:

1. The removals in section 7.
2. Moderator scope: list, ban and unban only, with promote and demote moved to admins.
3. Admins cannot read other users' private chats.
4. Admin bootstrap by GitHub login or by numeric GitHub id. A login can be renamed and later registered by someone else, who would then become admin; the numeric id cannot.
5. Self-service profile edit removed, with GitHub as the source of profile fields.

Phase 0 starts only after you answer.

## 9. Environment

```bash
DATABASE_URL=                     # unset in dev uses PGlite
NUXT_APP_SECRET=                  # sessions and derived encryption key
NUXT_PUBLIC_SITE_URL=
NUXT_PUBLIC_SITE_NAME=
NUXT_OAUTH_GITHUB_CLIENT_ID=
NUXT_OAUTH_GITHUB_CLIENT_SECRET=
NUXT_ADMIN_GITHUB_LOGINS=         # comma-separated GitHub logins
NUXT_INFERENCE_PLATFORM=          # openrouter | deepseek
NUXT_INFERENCE_API_KEY=           # instance key for the active platform
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_BUCKET=
S3_REGION=
S3_ENDPOINT=                      # for S3-compatible stores
```

## 10. Assumptions verified in phase P

| # | Assumption | Needs | Fallback |
|---|---|---|---|
| 1 | The untouched template installs, typechecks and boots | nothing | fix it before anything else |
| 2 | `hub:db` resolves in this repo in place of `@nuxthub/db` | nothing | keep `@nuxthub/db` |
| 3 | PGlite applies the new migration (identity column, jsonb) | nothing | require `DATABASE_URL` in dev |
| 4 | `nuxt-authorization`'s `authorize()` accepts the `nuxt/server` event, `allowGuest` works, and a denial can answer `404` | nothing | resolve the user and call the ability directly in the handler |
| 5 | `nuxt-auth-utils` helpers (`getUserSession`, `setUserSession`, `defineOAuthGitHubEventHandler`) work with `nuxt/server` handlers | GitHub OAuth app for the full login | an h3 handler for the OAuth route only |
| 6 | `nuxt-security` CSRF works with the installed h3 (the template pins h3 1.15.11 for `nuxt-csurf`) | nothing | add `nuxt-csurf` with the same pin |
| 7 | `deriveSecret()` is usable from server utils for key encryption | nothing | a dedicated env secret |
| 8 | `ai` v7 transport sends only the last message and the trigger (`prepareSendMessagesRequest`) | nothing | the template's two-call edit and regenerate flow |
| 9 | `blob.handleUpload()` accepts the `nuxt/server` event (the template does this) | nothing | `event.req.formData()` plus `blob.put()` |
| 10 | NuxtHub 0.10.12 S3 config keys, including a custom endpoint, and `blob.serve()` from a private bucket | S3 bucket | read the NuxtHub blob docs for the installed version; proxy bytes manually |
| 11 | Which endpoint field OpenRouter's `provider.only` expects (`tag` or provider slug), and that `metadata` reports the provider that served the turn | OpenRouter key | map from the endpoints response |
| 12 | OpenRouter web search tool spelling and result shape through the AI SDK provider | OpenRouter key | the web plugin through `extraBody` |
| 13 | `@ai-sdk/deepseek` exposes the server web search tool and effort levels | DeepSeek key | `@ai-sdk/openai-compatible` with pass-through body fields |
| 14 | DeepSeek usage reports cache-hit tokens through the AI SDK | DeepSeek key | bill all input at the cache-miss price |
| 15 | Browser-encoded 16 kHz WAV is accepted by both speech-to-text endpoints, and whether OpenRouter reports its cost | both keys | Ogg Opus from `MediaRecorder`; a null cost for dictation |
| 16 | PDF and CSV handling per platform | both keys | gate attachment types by `inputModalities`; images only where unsupported |

## 11. Out of scope

Side-by-side multi-model UI, branching UI, read-aloud, image generation, export and import, more than one platform active at once, cleanup of uploads that were never attached to a message, translations.
