# Optimization plan: page speed and the admin model pickers

Status: O1 to O4 done. It sits between milestone 2 (waiting for its live smoke run) and milestone 3, and changes no feature. Deviations: the admin settings form still waits for its data on a first visit (the form starts from it); changes are optimistic local or cache updates with rollback rather than `useMutation`, which would add nothing over them.

## 1. Findings

All measured on this machine, in Chromium, against the dev server.

### The model pickers on `/admin/settings`

Three separate causes, each reproduced:

1. **A card only gets a list when its platform is the active one.** The page loads one catalog, `GET /admin/models`, which is the active platform's, and gives every other card an empty list. With DeepSeek active, both OpenRouter pickers opened on "0 models".
2. **The list is a snapshot taken when the picker opens.** The catalog loads after the page appears. Opened before it arrived, the active platform's picker also showed "No model matches", and stayed empty for as long as it was open. Reopening it later showed the models. On a slow connection that window is seconds long.
3. **No loading or error state.** Loading, a failed catalog request and a platform with no key all look like the same empty table.

### Speech-to-text as a text box

That was a shortcut. The catalog call keeps only models that output text, and speech-to-text models are not among them, so I left the field as free text. OpenRouter does list them: `GET /models?output_modalities=transcription` returned 30 models keyless (`openai/whisper-1`, `openai/whisper-large-v3`, `mistralai/voxtral-mini-transcribe-3-0`, …), priced per second of audio. DeepSeek has no such setting (its speech-to-text has one fixed model), so only the OpenRouter card has the field.

### Speed

The dev database answers a bare `select 1` in **280 ms** (median of 10; opening a connection took 1.2 s). Every request makes several queries, one after another, and every page change waits for its requests before it shows anything.

| Page change | SQL queries | Click to page shown, local database | With 280 ms per query |
|---|---|---|---|
| Home | 10 | 135 ms | 2,976 ms |
| A chat | 13 | 156 ms | 2,144 ms |
| `/settings` | 5 | 138 ms | 1,569 ms |
| `/model-profiles` | 3 | 125 ms | 981 ms |
| `/admin/settings` | 14 | 145 ms | 2,991 ms |
| `/admin/models` | 4 | 138 ms | 1,281 ms |
| `/admin/users` | 2 | 144 ms | 710 ms |

The same on every visit: the second visit to a page was no faster than the first. Compiling in dev mode was not a factor (first and second visits differed by under 20 ms).

Changes are slow for the same reason: toggling one model setting is 5 queries (about 1.4 s), a vote 5, and sending a message makes about 18 queries before the model is even called (about 5 s).

Three things multiply:

- **Distance to the database:** 280 ms per round trip.
- **Round trips per request,** all in sequence:
  - The user row is loaded twice per request, once by `requireUser` and once by `authorize()`.
  - Each setting is its own query: `GET /admin/settings` makes 9 of them, the turn route about 8.
  - Reads that do not depend on each other still wait for each other (a chat, its shares, its lanes, its messages).
- **Nothing is kept on the client.** Pages `await useFetch(...)`, which holds the old page on screen until the data arrives, and fetches again on every visit. `/settings` and the home page also await two requests one after the other.

## 2. Targets

| | Today | Target |
|---|---|---|
| Sequential database round trips per read request | 2 to 10 | at most 2 |
| Per change (PATCH, vote) | 4 to 5 | at most 3 |
| Per turn, before the model is called | about 18 | at most 5 |
| Page change to a page seen before | 0.7 to 3 s | under 100 ms, from cache, refreshed in the background |
| Page change to a page not seen before | 0.7 to 3 s | page shell at once, data within 2 round trips |
| A menu toggle or vote | 1.4 s before it shows | shows at once, undone if the server refuses |

The targets hold at 280 ms per query; a closer database makes all of them better still (section 4).

## 3. Work

### Phase O1: the admin model pickers

- `GET /admin/models?platform=<id>` returns that platform's full catalog with its own instance key, whichever platform is active. Without a key it answers with an empty list and `hasKey: false`.
- Each card loads its own platform's catalog. The picker button is disabled with "Add a key first" when the platform has no key.
- `ModelBrowser` takes the list reactively and shows three more states: loading (skeleton rows), failed (the server's message and a Retry button), and empty.
- Speech-to-text becomes a picker: the adapter gains `listSttModels(apiKey)` (OpenRouter: `?output_modalities=transcription`), served by `GET /admin/models?platform=<id>&kind=stt`. The browser shows name, id and price per minute for these. The field appears where `capabilities.sttModel` is true, as today.

### Phase O2: fewer round trips on the server

- **One user load per request.** `requireUser`, `getUser` and `authorize()` share one lookup kept on `event.context`.
- **Settings in one query, cached.** `select * from setting` once, parsed into a map, kept in the process for 30 s and cleared by `setSetting`. `getSetting` reads from it. The allowlist and price overrides (`modelSetting`) get the same treatment, cleared by the admin models PATCH. Ceiling: with several server instances, another instance sees an admin's change up to 30 s late. The cache is keyed by database handle, so tests keep their isolation.
- **Independent reads together.** `Promise.all` where one read does not need another's result: a chat with its shares, lanes and messages (the access check still runs before anything is returned); a member's own API key alongside the user row (the session already holds the user id); the budget sum alongside the catalog.
- **The turn route in order.** Read everything first, in parallel groups; one transaction for the trigger; the three limit settings come from the cached map. The writes after the answer (usage row, answer, title) already do not delay the first token.
- `/settings` and the home page stop awaiting two requests in sequence (covered by O3).

### Phase O3: a client data layer on Pinia Colada

Pinia Colada keeps server data in a cache keyed by query, shared by every component, and refreshes it in the background. `@pinia/colada-nuxt` (installed) carries the cache from the server render to the browser.

- `app/queries/` defines each query once with `defineQueryOptions`:

| Query | Key | Fresh for |
|---|---|---|
| Model catalog and platform | `['models']` | 5 min (the server caches it for an hour) |
| Chat list | `['chats']` | 30 s |
| One chat with lanes and messages | `['chats', id]` | 30 s |
| Votes | `['chats', id, 'votes']` | 30 s |
| Profile and preferences, usage | `['me']`, `['me', 'usage']` | 30 s |
| Model profiles | `['model-profiles']` | 30 s |
| Upstream providers of a model | `['models', modelId, 'endpoints']` | 5 min |
| Admin: settings, a platform's catalog, speech-to-text models, users, invites | `['admin', …]` | 30 s; catalogs 5 min |

- Defaults in `colada.options.ts`: fresh for 30 s, kept 10 minutes after last use, refreshed when the window regains focus.
- Pages use `useQuery` instead of `await useFetch`. A page change no longer waits: a page seen before renders from the cache at once and refreshes behind it; a new page shows its shell and skeletons until the data arrives. The server render still includes the data.
- `useModels()` keeps its shape and reads the catalog query, so its many callers do not change.
- The chat page: the query seeds the live message list that streaming writes to. Each finished answer, edit and delete is written back into the cache (`setQueryData`), so returning to a chat shows the current conversation without a flash of the old one.
- The sidebar reads the chat list query. Rename, delete and the new title update the cache instead of calling `refreshNuxtData`.
- Prefetch: a chat when its sidebar entry is hovered or focused; the catalog and model profiles once after sign-in.
- Plain Pinia stores: none needed yet. Colada runs on Pinia; a store of our own is for client-only state that must outlive a page, and the first case is milestone 3's temporary chat.

### Phase O4: changes that show at once

- Changes go through `useMutation` with an optimistic cache update, rolled back with a toast if the server refuses: lane changes from the models menu (on or off, thinking mode, color, order), chat settings (web search, layout), votes (already optimistic by hand; moved onto the same pattern), chat rename and delete, the stop preference, the admin's "allowed" switches.
- Changes that need the server's answer keep a pending state on their button and on the form: adding a model, saving a profile, saving admin settings (a key is checked with the platform first).
- Skeletons for the chat page, the profile list and the admin tables when there is nothing cached. The top loading bar stays for the first load.

## 4. The database's distance (your call)

Everything above cuts the number of round trips and hides the wait. It does not shorten a round trip: at 280 ms, a request that is not cached still costs 0.3 to 0.6 s, and a turn about 1.5 s before the model is called.

- **Development:** the database in `.env.dev` is `…pgdb.ctrl-neo.dev`, 280 ms away from this machine. Leaving `DATABASE_URL` out of `.env.dev` uses the built-in local database (PGlite, data under `.data/`), where the same pages took 125 to 156 ms. A local Postgres in Docker does the same with the production engine.
- **Production:** unknown to me where the app will run. If it runs next to its database, a round trip is 1 to 5 ms and most of this problem never appears there; if it runs far from it, production feels like dev does now.

## 5. Phases

| # | Work | Done when |
|---|---|---|
| O1 | Per-platform catalogs, the picker's loading, error and no-key states, the speech-to-text picker | in Chromium with DeepSeek active: both OpenRouter pickers list OpenRouter's models; a picker opened before the catalog arrives fills in when it does; a platform without a key shows "Add a key first"; a speech-to-text model is picked from the list and dictation works with it |
| O2 | One user load, cached settings and allowlist, parallel reads, the turn route | the query counts in the targets table, measured per request; all tests pass; an admin's settings change is seen by the next request |
| O3 | Queries on Pinia Colada, non-blocking pages, cache write-back on the chat page, prefetch | with 280 ms added per query: a page seen before shows in under 100 ms; a new page shows its shell at once; returning to a chat after a new answer shows that answer without a refetch flash; the server render still contains the data (view source) |
| O4 | Optimistic changes, pending states, skeletons | with 280 ms added per query: a models-menu toggle and a vote show at once; a refused change is undone with a toast |

Order: O1 is small and fixes what is broken. O2 comes before O3 because it speeds up every request, the first load included, without touching the UI.

### Measuring

A throwaway Nitro plugin, as used for the numbers above: it wraps the local database client's `query` to count calls and to add a delay per call, with a small route to read the count and set the delay. Page changes are timed in the browser from `router.push()` to Nuxt's `page:finish` hook. The plugin is deleted after each phase.

## 6. Not in this plan

- A shared cache (Redis) for settings and catalogs: the per-process cache has a 30 s ceiling across instances, which is fine for one instance.
- Caching the user row between requests: role and ban checks stay per request, as milestone 1 decided.
- Streaming server render or lazy hydration: revisit only if the first load is still slow after O2.
- Offline use or persisting the query cache across reloads.
