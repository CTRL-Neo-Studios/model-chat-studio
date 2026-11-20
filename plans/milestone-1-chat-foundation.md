# Milestone 1: chat template frontend on an extended backend

Status: phases P (preparation), 0 (groundwork) and 1 (data and conventions) are done (2026-11-20). Phase 2 is next. Evidence for every "verified" claim below is in `plans/preparation-findings.md`.

Goal: the Nuxt UI chat template's frontend (`../chat`, upstream `nuxt-ui-templates/chat` at `f00f2a6`) running in this repo on PostgreSQL and S3, with invite-gated GitHub signup, a platform-agnostic inference layer (OpenRouter or DeepSeek), model and upstream-provider selection, sampling parameters, usage accounting and quotas.

## 1. Decisions

| Topic | Decision |
|---|---|
| Identity | GitHub OAuth only. Logto is removed. |
| Signup | `invite` (link required), `open` (any GitHub account) or `closed`, set by an admin. |
| Admin bootstrap | The first person to sign up becomes admin and bypasses the signup gate. Everyone after that is a normal user and goes through the gate. |
| Access control | Session cookie for authentication, user row loaded per request, abilities for every decision. See section 6. |
| Chat sharing | Like Google Docs: the owner, people the owner lists, or anyone with the link. Nobody else can read a chat, admins included. Shared access is read-only. |
| Roles | Moderators list users and ban or unban users of lower role. Promote, demote, delete and everything else administrative is admin only. |
| Profile | GitHub is the source of profile fields. Self-service profile editing is removed. |
| Anonymous use | None, except reading a chat whose link access is on. |
| Inference platform | One active platform at a time, `openrouter` or `deepseek`, chosen by an admin in the dashboard and swappable there. All calls go through one adapter interface; rows record the platform so history survives a switch. |
| Keys | One instance key per platform, entered by an admin in the dashboard and stored encrypted. An optional per-user key (encrypted) overrides it. |
| Catalog | Live from the platform, filtered by an admin allowlist. An empty allowlist allows everything. |
| Quota | Monthly USD budget per user: instance default, per-user override, `null` means unlimited. Requests on a user's own key are exempt. |
| Multi-model | Schema-ready only (`message.parentId`, model and provider per message). The UI stays single-model. |
| Dictation | Record, then transcribe. Neither platform streams recognition, so the template's live preview is dropped. |
| Storage | NuxtHub's own blob drivers, chosen at build time from the environment: S3 (`S3_*`), Vercel Blob as an optional backend, local files otherwise. The bucket is private. |
| Database | Migration `0000` is regenerated; nothing is deployed. Migrations apply automatically in dev from phase 1 on. |
| DeepSeek safety check | An admin setting, off by default, with a warning that explains what it does. |
| DeepSeek PDFs | In this milestone, through DeepSeek's file parsing flow (upload, then reference by `file_id`). |
| Language | English strings only. `@nuxtjs/i18n` stays installed and untouched. |
| Demo tools | The chart tool is kept. The weather tool is dropped (it returns random data). |

## 2. Conventions

### Server code imports from `nuxt/server`

Every handler in `server/api` and `server/routes` imports explicitly from `nuxt/server`, including `defineEventHandler`. The auto-imported names of the same spelling are h3's and take a different event; mixing them raises `NUXT_E8012`. `defineHandler` does not exist in `nuxt/server` 4.6.4.

```ts
import { createError, defineEventHandler, getRouterParam, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'

export default defineEventHandler(async (event) => {
	const id = getRouterParam(event, 'id', { decode: true })
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
| `getValidatedRouterParams(event, fn)` | `getRouterParam(event, name, { decode: true })` plus a zod parse |
| `readValidatedBody(event, schema.parse)` | `readValidatedBody(event, schema)` (Standard Schema) |
| `H3Event` type | `RequestEvent` type |
| `readMultipartFormData(event)` | `await event.req.formData()` (web standard) |
| client abort | `event.req.signal` |

A handler may return a `Response` or a `ReadableStream`, which is how the chat stream is returned. `getRouterParam` returns percent-encoded values unless `{ decode: true }` is passed.

Documented exceptions, because `nuxt/server` does not cover them:

- `server/plugins/authorization-resolver.ts` stays a Nitro plugin (`defineNitroPlugin` and the `request` hook are Nitro-only).
- Caching does not use `defineCachedFunction`. The catalog cache is a module-level `Map` with a TTL.
- Secrets use `deriveSecret(purpose)` from `nuxt/server`, so `NUXT_APP_SECRET` is the only secret to configure.

The existing eleven handlers under `server/api/v1` and both files in `server/utils/core` are migrated to this convention in phase 1.

### Other conventions

- Database access: `import { db, schema } from 'hub:db'`. It is an alias of `@nuxthub/db`, so this is one spelling, not a migration.
- Money columns are `numeric(16, 8)` with Drizzle's `mode: 'number'`, so they come back as numbers, not strings.
- Authorization goes through the wrapper in `server/utils/core/authorize.ts` (section 6). Nitro auto-imports it under the name `authorize` and it shadows nuxt-authorization's server `authorize` (the build logs "Duplicated imports"), so even a bare `authorize(...)` gets the wrapper. Handlers never call the module's `allows` or `denies` on the server.
- API prefix: `/api/v1`. OAuth lives at `/auth/github` as a server route.
- Formatting: tabs, per `.editorconfig`. Ported template files are reformatted.
- Package manager: bun. Tests: `bun run test` (`bun test`), files in `test/`, no framework.
- Table and column names are camelCase, as in the existing schema (`chatShare`, `"userId"`).

## 3. Inference layer

`server/utils/inference/` holds `types.ts`, `openrouter.ts`, `deepseek.ts` and `index.ts`. `useInference()` reads the active platform and its instance key from the `setting` table and returns that adapter.

```ts
export interface InferencePlatform {
	id: 'openrouter' | 'deepseek'
	capabilities: { providerRouting: boolean, safetyCheck: boolean, nativeTitle: boolean }
	listModels(apiKey: string): Promise<CatalogModel[]>
	listEndpoints?(apiKey: string, modelId: string): Promise<CatalogEndpoint[]>
	/** Everything `streamText` needs for one turn. */
	prepare(input: TurnInput): { model: LanguageModel, tools?: ToolSet, providerOptions?: ProviderOptions }
	/** Turns a stored PDF into the part this platform accepts. */
	attachPdf(input: { apiKey: string, file: StoredFile, bytes: Uint8Array }): Promise<FilePart>
	/** Tokens, cost, the upstream provider that served the turn, and a title if the platform made one. */
	usage(step: FinishStep): TurnUsage
	transcribe(apiKey: string, wav: Blob): Promise<{ text: string, costUsd: number | null }>
}
```

`TurnInput` carries `apiKey`, `model`, `providers`, `allowFallbacks`, sampling params, `reasoningLevel`, `webSearch`, `userId`, `firstTurn` and `safetyCheck`.

`CatalogModel` is normalized:

- `id`, `name`, `vendor`, `contextLength`, `maxOutputTokens`
- `inputModalities`: `text`, `image`, `file` (`file` means PDFs are accepted)
- `webSearch`: whether the search toggle applies to this model
- `supportedParameters`
- `reasoning: { mandatory, defaultEnabled } | null`, `reasoningLevels`, `defaultReasoningLevel`. Empty levels with a non-null `reasoning` means an on/off toggle only.
- `pricing: { input, cacheRead?, output }` in USD per 1M tokens, optional

`CatalogEndpoint`: `tag`, `name`, `quantization`, `status`, `uptime30m`, `uptime1d`, `contextLength`, `maxOutputTokens`, `pricing`.

| Capability | OpenRouter | DeepSeek |
|---|---|---|
| AI SDK provider | `@openrouter/ai-sdk-provider` 3.1 | `@ai-sdk/deepseek` 3.0, Chat Completions (`.chat()`), plus glue |
| Catalog | `GET /api/v1/models` | `GET /models` |
| Upstream providers | `GET /api/v1/models/:id/endpoints` | none; the picker is hidden |
| Cost | reported per turn | tokens × price table below |
| Web search | `openrouter:web_search` server tool | `deepseek_web_search` and `deepseek_read_url`, `deepseek-flash` only |
| Reasoning | `reasoning` provider option | `thinking` and `reasoningEffort`; levels are `none` plus the model's `effort.supported_levels` |
| Title | separate call with the `titleModel` setting | `title` flag on the first turn, free |
| Images | models whose input modalities include `image` | `deepseek-flash` only |
| PDF | inline, any model | upload to `/files`, reference by `file_id`, `deepseek-flash` only |
| Dictation | `POST /api/v1/audio/transcriptions`, model from the `sttModel` setting | `POST /v1/tools/asr` |

### Switching platforms

The active platform and each platform's instance key are admin settings, not environment variables. Keys are encrypted the same way as personal keys and are never sent back to the browser.

- **Per-platform data.** `defaultModel`, `titleModel`, `sttModel` and the instance key are stored per platform. `modelSetting`, `userApiKey` and `providerFile` are already keyed by platform. Switching back restores everything.
- **Existing chats** keep their history. If a chat's stored model does not exist on the new platform, the picker and the next turn use that platform's default model.
- **Saving a key** checks it by listing models, so a wrong key is rejected at once.
- **Nothing configured yet.** Until a platform and key are set, sending is disabled with a notice, and admins get a link to the settings page.
- **Not yet verified:** replaying history written by one platform to the other (reasoning parts and provider metadata). It is checked in phase 3 with both keys.

### OpenRouter specifics

- Routing goes in `providerOptions.openrouter.provider` as `{ only, order, allow_fallbacks }`. The values are endpoint **tags** such as `deepinfra/fp4/flex`. A bare slug such as `deepinfra` does not match tier endpoints, so the exact tag the user picked is sent.
- The picker shows `provider_name` and stores the tag. The provider that served a turn comes back as a display name in `providerMetadata.openrouter.provider`.
- Cost is `providerMetadata.openrouter.usage.cost`, read from the `finish-step` part. No `usage: { include: true }`; OpenRouter always includes usage.
- Web search is `openrouter.tools.webSearch({})`. The helper puts options at the top level while the docs nest them under `parameters`; when options are needed, pass `{ parameters: {...} }` with a cast.
- `reasoning_details` stay on stored reasoning parts and are sent back on later turns.
- PDFs are sent inline with the `file-parser` plugin set to `cloudflare-ai` (free). The default `mistral-ocr` is billed per page.
- Speech-to-text models are listed only by `/models?output_modalities=transcription`. The response includes `usage.cost`.

### DeepSeek specifics

The glue is about 40 lines, prototyped in `scripts/spikes/deepseek/glue.ts` on branch `prep/spikes`:

- A `fetch` wrapper on `createDeepSeek` adds the web tools, `title` and `safety_check` to the request body. The provider silently drops all of them when they are passed as options.
- A `wrapLanguageModel` middleware reads the last raw chunk, turns its citations into `source` parts and puts its title in `providerMetadata.deepseek.title`.

Rules that follow from DeepSeek's API:

- Never use `deepSeek.tools.webSearch()`. It sends the Responses API's `web_search` tool, which only `deepseek-v4-pro` supports.
- Reasoning must be sent back whenever tools are declared, otherwise DeepSeek returns 400. The chart tool is always declared, so stored reasoning parts are never stripped.
- `userId` is passed on every turn. DeepSeek uses it to isolate content safety and caching per user.
- DeepSeek ignores `temperature` and `top_p` while thinking, web search, the safety check or the title flag is on. The settings panel disables both controls in the first three cases and says why. The first turn always ignores them, because of the title flag.
- An answer can end in a refusal after text has streamed. The UI then replaces it with a refusal notice, and the notice is what gets stored.
- Speech to text takes at most 120 s and 8 MiB, so the server rejects longer clips before calling. Cost is `ceil(duration_ms / 1000)` seconds at the list price.

**PDFs** follow DeepSeek's file parsing guide (<https://api-docs.deepseek.com/guides/document_parsing>):

1. On first use, upload the PDF to `POST /files` with `purpose=text_recognition`. The `purpose` field must come before `file`. Parsing is billed once per page at upload.
2. Cache the returned `file_id` in `providerFile`, keyed by our file, the platform and a hash of the API key. A `file_id` belongs to one DeepSeek account, so a user's own key gets its own upload.
3. Reference it in chat as `{ "type": "file", "file_id": "…" }`.
4. Delete the remote file when our file is deleted.

`@ai-sdk/deepseek` drops PDF file parts, so step 3 needs help on our side. The provider does emit exactly that block for an image reference, so the adapter passes the `file_id` as a reference with an image media type. If a provider update breaks this, the `fetch` wrapper rewrites the body instead. The live check covers it.

The upload response has no page count, so the parse cost is recorded as null. The ceiling is $0.225 per PDF (1,000 pages).

### DeepSeek prices

DeepSeek's `/models` carries no pricing and responses carry no cost, so the adapter ships a table from <https://api-docs.deepseek.com/quick_start/pricing> (read 2026-11-20), USD per 1M tokens:

| Model | Input, cache hit | Input, cache miss | Output |
|---|---|---|---|
| `deepseek-flash` | 0.006 peak, 0.003 off-peak | 0.30 peak, 0.15 off-peak | 1.20 peak, 0.60 off-peak |
| `deepseek-v4-pro` | 0.044 peak, 0.022 off-peak | 1.32 peak, 0.66 off-peak | 3.96 peak, 1.98 off-peak |

- Cost per turn is `cacheReadTokens × hit + noCacheTokens × miss + outputTokens × output`. The provider maps DeepSeek's cache-hit count to `usage.inputTokenDetails.cacheReadTokens`.
- Peak is 01:00–04:00 and 06:00–10:00 UTC, Monday to Friday. Chinese public holidays are off-peak; the adapter ignores them, which overcounts slightly and never undercounts.
- Speech to text is 0.116 per hour of audio at list price.
- Server-side search calls are billed as model tokens, so they need no separate line.
- Price resolution: admin override in `modelSetting`, else the table, else uncounted with a warning on the admin models page.

## 4. Schema

PostgreSQL through Drizzle `pgTable`, in `server/db/schema.ts`.

| Table | Columns of note |
|---|---|
| `user` | `id` uuid, `githubId` bigint unique, `username`, `name`, `email` (nullable: GitHub may hide it), `avatarUrl`, `role`, ban fields, `monthlyBudgetUsd` numeric null |
| `invite` | `codeHash` unique, `createdBy`, `maxUses`, `useCount`, `expiresAt`, `revokedAt` |
| `setting` | `key` PK, `value` jsonb: `signupMode`, `defaultMonthlyBudgetUsd`, `safetyCheck`, `inferencePlatform`, and per platform `apiKey` (ciphertext), `defaultModel`, `titleModel`, `sttModel` |
| `modelSetting` | PK (`platform`, `modelId`), `enabled`, `priceInput`, `priceCachedInput`, `priceOutput` (null means no override) |
| `userApiKey` | PK (`userId`, `platform`), `ciphertext` (first byte is a key version) |
| `chat` | `id` uuid, `userId` FK cascade, `title`, `visibility` (`private` or `public`), `systemPrompt`, `params` jsonb |
| `chatShare` | PK (`chatId`, `userId`), both FK cascade |
| `message` | `id` text, `seq` identity, `chatId` FK cascade, `parentId` self FK null, `role`, `parts` jsonb, `metadata` jsonb |
| `vote` | PK (`chatId`, `messageId`), `isUpvoted` |
| `file` | existing columns plus `chatId` uuid (no FK), `messageId` FK null, `mediaType`, `size` |
| `providerFile` | PK (`fileId`, `platform`, `keyHash`), `remoteId`, `expiresAt` |
| `usageEvent` | `userId`, `chatId` set null, `kind` (`chat`, `title`, `stt`, `parse`), `platform`, `model`, `provider`, token counts, `costUsd`, `byok`, `createdAt` |

Reasons behind the shape:

- `message.seq` orders messages. The template orders by a second-precision timestamp, so messages saved in the same second can swap.
- `usageEvent` is append-only. Edit and regenerate delete message rows, so summing messages would refund spend.
- `message.metadata` carries `platform`, `model`, `provider`, tokens and cost for display. It is the AI SDK `UIMessage.metadata` field, sent with `messageMetadata`.
- `chat.visibility` is link access: `public` means anyone with the link. `chatShare` is the list of people. The two are independent, as in Google Docs.
- `file.chatId` has no foreign key because the home page uploads before the chat row exists.
- `chat.params`: `model`, `providers`, `allowFallbacks`, `temperature`, `topP`, `maxOutputTokens`, `reasoningLevel`, `webSearch`. One zod schema in `shared/` validates it on both sides.

## 5. API surface

All under `/api/v1`, all requiring a user unless noted.

| Route | Purpose |
|---|---|
| `GET /chats`, `POST /chats` | list own chats; create with the first message |
| `GET /chats/:id` | read; allowed for the owner, listed people, and anyone when link access is on |
| `PATCH /chats/:id` | owner only: title, visibility, shared people, system prompt, params |
| `DELETE /chats/:id` | owner only: delete the chat, its blobs, remote files and file rows |
| `POST /chats/:id` | owner only: stream a turn (see below) |
| `GET /chats/:id/votes`, `POST /chats/:id/votes` | owner only, as in the template |
| `GET /users/search?q=` | find people to share with: `id`, `username`, `name`, `avatarUrl`; at least 2 characters, 10 results |
| `GET /models` | catalog, allowlist applied, cached one hour |
| `GET /models/endpoints?id=` | upstream providers for one model (ids contain slashes, so a query parameter) |
| `PUT /files/:chatId`, `GET /files/:id`, `DELETE /files/:id` | upload, serve, delete; reading follows the chat's access |
| `POST /transcriptions` | WAV in, text out |
| `GET /users/me`, `GET /me/usage`, `PUT /me/api-key`, `DELETE /me/api-key` | profile, month spend against budget, personal key |
| `/users/**` | existing user management, migrated to `nuxt/server`, plus budget |
| `/admin/invites`, `/admin/settings`, `/admin/models` | admin only; settings include the active platform and its key, which is write-only |
| `GET /auth/github` (server route) | OAuth callback and signup gate |

`GET /users/search` shows every signed-in member the names of the other members. That is what sharing with listed people requires.

### One turn (`POST /chats/:id`)

1. Require the user, load the chat by owner, validate the body.
2. Check the model against the allowlisted catalog and the chosen provider tags against its endpoints.
3. Resolve the platform and key: the active platform from settings, then the user's key for it, else the instance key. With no platform or key configured, answer `503` with a clear message.
4. On the instance key, compare this month's `usageEvent` sum with the budget. Over budget returns `402`.
5. Apply the trigger. `submit-message` saves the new user message; an edit truncates after it; `regenerate-message` truncates from the target, or from the last assistant message when no id is sent. Truncation deletes the attached blobs first.
6. Build model messages from the database. Attachments are converted by media type (table below).
7. Call `streamText` with the adapter's `prepare()` output, the system prompt, the chart tool and `event.req.signal`. Return it with `sendSources: true`, `messageMetadata` and a server `generateMessageId`.
8. Title on the first turn: a parallel call on OpenRouter; the `title` flag on DeepSeek. If none arrives, use the start of the user message.
9. On finish, insert the assistant message with metadata and one `usageEvent` row. Cost and provider come from the `finish-step` part, tokens from `finish`.

Message ids are generated on the server and sent to the client, because an edit refers to a message by id. Without `generateMessageId` the stored assistant message has an empty id.

Attachments by media type:

| Type | OpenRouter | DeepSeek |
|---|---|---|
| Images | inline, when the model accepts images | inline, `deepseek-flash` only |
| PDF | inline, any model | `attachPdf()`: upload once, reference by `file_id`, `deepseek-flash` only |
| CSV and other text | decoded on the server, sent as text | decoded on the server, sent as text |

Uploads:

- Read with `event.req.formData()`, check with `ensureBlob()` (which answers 400), store with `blob.put()` under `<userId>/<chatId>/<uuid>.<ext>`. The original name lives only in the `file` row. `blob.handleUpload()` is not used: it stores the client's filename and turns rejections into 500.
- Serve with `Cache-Control: private`, and `Content-Disposition: attachment` for anything that is not an allowed image or PDF type. Otherwise an uploaded HTML or SVG file would render on the app's own origin.
- Delete blobs one at a time. The S3 driver's batch delete sends no `Content-MD5`, which AWS requires.

Differences from the template, on purpose:

- The client sends only the new message. The template trusts the whole client-supplied history.
- Truncation happens inside the stream request. The template makes a separate delete call first.
- The title no longer blocks the first token.

Known ceilings:

- Two concurrent streams can overshoot a budget by one request.
- An aborted or failed stream may report no usage and is then recorded with a null cost.
- On DeepSeek, pages read with `deepseek_read_url` are not carried into later turns, and search progress is not shown live.

## 6. Auth, signup and access control

### Signup flow

1. `/invite/[code]` validates the code, stores it in the sealed session and redirects to `/auth/github`.
2. `server/routes/auth/github.get.ts` uses `defineOAuthGitHubEventHandler` from `nuxt-auth-utils`, which is built on `nuxt/server`.
3. A known `githubId` logs in, unless banned. Profile fields are refreshed from GitHub.
4. A new account is created when no user exists yet, signup is `open`, or the invite claim succeeds. The first account gets the admin role. The check and the insert run in one transaction under an advisory lock, so two simultaneous first signups cannot both become admin. The invite claim is one statement: `UPDATE invite SET useCount = useCount + 1 WHERE codeHash = ? AND useCount < maxUses AND not expired AND not revoked RETURNING id`.
5. Otherwise the user lands on `/signin?error=signup_closed`.

The session cookie carries `{ id, role, username, name, avatar }`. The server still reads role and ban state from the database on every request through the existing resolver.

Whoever signs up first owns the instance, so sign up yourself before sharing the address.

### Access control

Three layers, all enforced on the server:

1. **Authentication.** The sealed session cookie from `nuxt-auth-utils`. The role inside the cookie only shows or hides UI.
2. **Identity per request.** The existing resolver plugin loads the user row by session id, so a ban or role change applies on the next request. It returns `null` for a guest.
3. **Authorization.** Abilities in `shared/abilities/`, defined with `nuxt-authorization`'s `defineAbility`, the pattern `userAbilities.ts` already uses. A handler loads the resource, then calls the wrapper: `authorize(event, ability, resource)` from `server/utils/core/authorize.ts`.

The wrapper exists because the module's own server `authorize()` lets requests through when it should deny them. It swallows every error that is not its own, so an ability that throws passes. It also treats only `null` as a guest, while this repo's resolver returned `undefined`. The wrapper resolves the user, turns `undefined` into `null`, calls the non-swallowing `authorize` from `nuxt-authorization/utils`, and returns other errors as 500.

Every ability starts with `satisfies(user)`, which rejects banned users. New files: `chatAbilities.ts`, `fileAbilities.ts`, `adminAbilities.ts`.

| Actor | Allowed |
|---|---|
| Guest | read a chat whose link access is on, and its files; `/signin`; `/invite/[code]` |
| User | own chats, messages, votes and files; read chats shared with them or by link; find people to share with; the allowlisted catalog; own usage and API key |
| Moderator | list users; ban and unban users of lower role |
| Admin | everything a moderator can; promote, demote and delete users; budgets; invites; signup mode; safety check; model allowlist and prices |

Chat access, in order:

1. The owner can do everything.
2. A person in `chatShare` can read the chat and its files.
3. When `visibility` is `public`, anyone with the link can read, signed in or not.
4. Everyone else gets `404`, admins and moderators included.

Rules:

- Shared access is read-only: no sending, editing, voting, renaming or resharing.
- The read ability is declared with `allowGuest: true` and returns `deny({ statusCode: 404 })` itself. Without `allowGuest`, a guest gets 403 before the ability runs.
- A role action applies only to a target of strictly lower role, and never to oneself.
- Three checks are policy rather than abilities and run on the server for every turn: the model allowlist, the provider list and the budget. The signup gate runs at account creation. Filtering in the client is cosmetic.
- API keys never leave the server. `GET /users/me` reports only whether a personal key is set.
- CSRF: `security.csrf` turns on `nuxt-csurf`, with `methodsToProtect` set to POST, PUT, PATCH and DELETE. The chat transport and uploads send the `csrf-token` header.
- The stream and transcription routes are rate limited.

Fixes to rules that exist today:

- Done in phase 1: every `authorize()` call in `useServerUsers.ts` moved to the wrapper.
- `demoteUser` and `banUser` compare no roles, so a moderator can demote or ban an admin. Both get the strictly-lower rule.
- `promoteUser` lets a moderator create moderators. Promote and demote become admin only.
- Done in phase 1: `PATCH /users/:id` is admin only with a strict zod allowlist (`role`, `monthlyBudgetUsd`); the old denylist and unvalidated body are gone.
- `banExpires` is stored but never read. `getBanned` in `shared/utils/roles.ts` treats an expired ban as lifted.
- `app/plugins/authorization-resolver.ts` reads `useUserSession().user` instead of `useAuthSession().user`.

Known ceiling: a demoted admin keeps seeing admin navigation until the session refreshes. Every admin request already fails with `403`.

## 7. Frontend

### Ported from the template

- `layouts/default.vue`, `pages/index.vue`, `pages/chat/[id].vue`, `middleware/transitions.global.ts`.
- `components/`: `Navbar`, `UserMenu`, `ModalConfirm`, `ModalRename`, and under `chat/`: `Prompt`, `PromptMenu`, `ChatTitle`, `DictateButton`, `Indicator`, `SourceLink`, `Comark.ts`, `message/*`, `tool/Chart`, `tool/Sources`.
- `composables/`: `useChats`, `useChatActions`, `useFileUpload`.
- `utils/`: `ai.ts`, `tool.ts`, `url.ts`; `shared/utils/file.ts`, `shared/utils/tools/chart.ts`.
- The template's CSS additions in `main.css`.

### Rewritten

- `useModels` and `ModelSelect`: catalog from `/models`, search, vendor groups, price, context length, modalities.
- `useChatSettings`: per-chat `params` saved with `PATCH /chats/:id` instead of cookies.
- `ChatVisibility`: becomes the share dialog. It has a people picker backed by `/users/search`, the list of people with access, a link access switch and the copy-link button.
- `useDictation`: keeps the microphone capture and level meter, collects samples, encodes 16 kHz mono 16-bit WAV on stop and posts it. `SAMPLE_RATE` and `MAX_DURATION` stay as constants. 120 s at 16 kHz is 3.84 MB; at 48 kHz it would be 11.5 MB, over DeepSeek's 8 MiB limit.
- The chat transport: `prepareSendMessagesRequest` sends only the new message, the trigger and the message id, with the CSRF header. `regenerate` always passes the message id.
- `app/utils/tool.ts` `getSources()`: sources arrive as `source-url` parts on both platforms.

### New

- Provider picker beside the model picker: Auto or chosen providers, a fallback toggle, and price, quantization and uptime per endpoint. Rendered only when `capabilities.providerRouting` is true.
- Chat settings panel: system prompt, temperature, top-p, max output tokens, reasoning level. Each control appears only if the model lists the parameter, and reasoning is a toggle when the model has no levels.
- Attachment and web search controls follow the selected model's `inputModalities` and `webSearch`.
- Reply footer: model, provider, tokens, cost. A refusal notice replaces a refused answer.
- `/signin` with the GitHub button and `/invite/[code]`.
- `/settings`: month usage against budget, personal API key.
- `/admin/users`, `/admin/invites`, `/admin/models`, `/admin/settings`.
- `/admin/settings` holds the signup mode, the default budget, the active inference platform, and for each platform its API key and default, title and speech-to-text models.

The safety check switch on `/admin/settings` appears only when `capabilities.safetyCheck` is true. It is off by default and carries this warning:

- DeepSeek reviews every message and every answer.
- A flagged answer is replaced by a refusal, even after part of it has streamed.
- Review tokens are billed as output tokens.
- Temperature and top-p are ignored while it is on.
- DeepSeek recommends turning it on for a service open to the public.

### Removed from this repo

- `server/api/v1/auth/logto.get.ts` and the Logto env vars (removed in phase 1: the new `user` table no longer fits it).
- `app/components/Layout/Header.vue` and `app/components/Logo.vue` (it points at a missing `/logo.png`).
- `app/composables/core/useAuthSession.ts`, `useMe.ts` and both `session-prefetch` plugins. Template components call `useUserSession()` directly. `app/plugins/authorization-resolver.ts` is kept and rewired (section 6).
- The two named middlewares, replaced by one global `auth` middleware.
- `routeRules['/'].prerender`. `/` becomes the signed-in chat home, and a prerendered page carries no CSRF token.
- `@vercel/blob` (already removed).

## 8. Phases

Phase P is done. Phases 2 and 3 are independent once phase 1 is done, and phases 7 and 8 are independent once phase 5 is done.

| # | Phase | Work | Done when |
|---|---|---|---|
| P | Preparation | Done. See `plans/preparation-findings.md`. | The live checks in section 10 still wait for credentials |
| 0 | Groundwork | Done. Dependencies and scripts (below), the four baseline typecheck errors, ESLint, CSRF, the production database driver guard, `.env.example`, README. | `bun run lint` and `bun run typecheck` pass |
| 1 | Data and conventions | Done. New schema, regenerated migration `0000_init`, `applyMigrationsDuringDev: true`, handlers and utils on `nuxt/server` and `hub:db`, the authorization wrapper and its test, the resolver returning `null` for guests, Logto removed, user lookups by non-UUID ids find nobody | migration applied on PGlite and on a throwaway Postgres 16; user routes answer as before; a throwing ability answers 500 |
| 2 | Auth and access control | GitHub handler, invite flow, first-user admin, global auth middleware, abilities and rule fixes from section 6, removals from section 7 | invite claim test passes; a second use of a single-use invite is refused; only the first signup becomes admin; a moderator cannot ban or demote an admin |
| 3 | Inference adapter | Both adapters, the DeepSeek glue, platform and key settings, catalog cache, per-model capabilities, allowlist filter, key resolution and encryption | the adapter tests pass offline; with a key, one turn streams on that platform with routing, reasoning, web search and usage printed; switching platform changes the catalog |
| 4 | Chat backend | Routes in section 5 except files and transcription; sharing; ledger and quota | ordering, quota, truncation and chat access tests pass; a turn streams through `curl` |
| 5 | Frontend port | Section 7 "Ported" on the new API | create, stream, edit, regenerate, vote, rename, delete and share work in the browser |
| 6 | Extended chat UI | Model and provider pickers, settings panel, reply footer, share dialog | changing provider changes `metadata.provider` on the next reply; a listed person can open a private chat and a stranger gets 404 |
| 7 | Files and dictation | File routes on `hub:blob`, attachments by media type, DeepSeek PDF upload flow, WAV dictation | an image and a PDF reach a model on each platform; a spoken sentence lands in the prompt on both |
| 8 | Admin and settings | Admin pages, `/settings`, the platform switch and keys, the safety check switch | an admin can invite, ban, set a budget, disable a model, switch signup mode and switch platform from the UI |
| 9 | Hardening | Rate limits on stream and transcription, CSP review, full smoke run per platform | smoke run passes on OpenRouter and on DeepSeek |

Phase 0 dependencies:

- Add `ai`, `@ai-sdk/vue`, `@openrouter/ai-sdk-provider`, `@ai-sdk/deepseek`, `@comark/vue`, `shiki`, `@shikijs/langs`, `@tanstack/charts`, `date-fns`. `aws4fetch` was already added.
- Add as dev dependencies `@nuxt/eslint`, `eslint`, `@types/node`.
- Scripts read the env files: `dev` and `db:migrate` read `.env.dev`; `build` and `preview` read `.env.prod`. A missing file is ignored.
- Add the `lint`, `db:generate` and `db:migrate` scripts.

Tests kept small and pure where possible: invite claim, quota sum, message ordering, truncation, chat access (owner, listed, link, stranger, admin), the authorization wrapper, DeepSeek cost (peak window and cache split), and each adapter's option mapping.

## 9. Environment and deploy

```bash
DATABASE_URL=                     # unset in dev uses PGlite
NUXT_APP_SECRET=                  # sessions and the derived encryption key
NUXT_PUBLIC_SITE_URL=
NUXT_PUBLIC_SITE_NAME=
NUXT_OAUTH_GITHUB_CLIENT_ID=
NUXT_OAUTH_GITHUB_CLIENT_SECRET=
S3_ACCESS_KEY_ID=                 # storage variables must be set at build time
S3_SECRET_ACCESS_KEY=
S3_BUCKET=
S3_REGION=                        # required for AWS
S3_ENDPOINT=                      # for S3-compatible stores (path-style URLs)
BLOB_READ_WRITE_TOKEN=            # Vercel Blob instead of S3; also needs @vercel/blob
```

- **App secret.** `NUXT_APP_SECRET` seals sessions and derives the key that encrypts stored API keys, both the instance keys and personal ones. `NUXT_SESSION_PASSWORD` is not used. Rotating the secret logs everyone out and makes every stored key unreadable. Set it in `.env.dev` as well; otherwise deleting `.nuxt` orphans encrypted keys in the dev database.
- **Database.** If `DATABASE_URL` is present while building, NuxtHub writes it into the bundle. A build without it would silently use PGlite, so an inline module in `nuxt.config.ts` forces the `postgres-js` driver for real builds; the URL is then read at runtime. `nuxt prepare` and `nuxt typecheck` are left alone, because they would otherwise switch the driver under a running dev server.
- **Migrations.** In dev they apply at boot. On a server, run `DATABASE_URL=… npx nuxt db migrate` before starting the new version. There is no runtime migration, and statements run without a transaction.
- **Storage.** The repo uses NuxtHub's auto-detected blob driver with its own variable names. The driver and its credentials are fixed at build time and written into the bundle; runtime env is not read. So the build needs the storage variables, and `.output/` must be treated as secret and never published. Building the storage at runtime instead would keep credentials out of the build, at the cost of the Vercel Blob option; that is the upgrade path if images are ever distributed.
- **Cookies.** The session cookie is `Secure` by default, so anything other than localhost needs HTTPS.
- **OAuth callback.** Only the GitHub client id and secret are needed. The callback URL is built from the request, and GitHub rejects one that does not match the OAuth app. `NUXT_OAUTH_GITHUB_REDIRECT_URL` exists for a proxy that does not pass the public host and protocol through.

## 10. Preparation results

All 16 assumptions were checked; details and evidence are in `plans/preparation-findings.md`. Their consequences are folded into the sections above.

These live checks still need credentials. Each runs from the `prep/spikes` worktree (`../model-chat-studio-prep`):

| Credential | Checks | Command |
|---|---|---|
| OpenRouter key | routing by tag, web search, speech to text, PDF, CSV | `OPENROUTER_API_KEY=… bun scripts/spikes/openrouter/live.ts` |
| DeepSeek key | glue, cache tokens, title, chart tool beside web tools | `DEEPSEEK_API_KEY=… AI_SDK_LOG_WARNINGS=false bun scripts/spikes/deepseek/glue.ts --live` |
| DeepSeek key | catalog, speech to text, file upload | `DEEPSEEK_API_KEY=… bun scripts/spikes/deepseek/rest.ts --live` |
| S3 bucket | put, get, list, private access, batch delete | `S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=… S3_BUCKET=… S3_REGION=… [S3_ENDPOINT=…] bun scripts/spikes/nuxt/s3-live.ts` |
| GitHub OAuth app | full login | callback `http://localhost:3101/api/_spike/session/github`; steps in `scripts/spikes/reports/prep-nuxt.md` |

One answer changes the design: DeepSeek's docs are ambiguous on whether a function tool can be declared together with the web tools, `title` and `safety_check`. If it cannot, the chart tool is left out of DeepSeek turns that use web search.

## 11. Out of scope

- Side-by-side multi-model UI and branching UI.
- A "Shared with me" list, and edit access for shared people.
- Read-aloud and image generation.
- Export and import.
- More than one platform active at once.
- Figures inside PDFs on DeepSeek (`rich_layout_recognition`), and Word or PowerPoint uploads.
- Live search progress and carried-over page reads on DeepSeek.
- Cleanup of uploads that were never attached to a message.
- Translations.
