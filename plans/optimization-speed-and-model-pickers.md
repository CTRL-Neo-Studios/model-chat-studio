# Optimization plan: page speed and the admin model pickers

Status: O1 to O6 done (O6 in section 7). O1 to O4 came between milestones 2 and 3, O5 and O6 after milestone 6.1; none changes a feature. Deviations: changes are optimistic local or cache updates with rollback rather than `useMutation`, which would add nothing over them.

O5 (after milestone 6.1): the server no longer waits for data. Every query is lazy on the server (`enabled: () => import.meta.client` in `colada.options.ts`, Pinia Colada's "lazy queries"; a query with its own `enabled` adds `import.meta.client &&`), so a reload or a link gets the page with its skeletons and the browser fetches the data. Measured on `bun run dev` with the database 280 ms away: first byte 2 to 3.5 s before, 20 to 40 ms after; data in 0.8 to 1.8 s, skeletons meanwhile; no hydration warnings. The three places that still waited now show at once: `/admin/settings` (the form fills in when its settings arrive), the home page (the models menu is a placeholder until the profiles arrive) and "New chat here" (sending waits for the folder's defaults, typing does not). The server render no longer contains the data (view source shows skeletons).

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
- Streaming server render or lazy hydration: not needed after O5.
- Offline use or persisting the query cache across reloads.

## 7. Phase O6: which pages arrive with their data, and a shorter wait on all of them

Status: built. Measured on `bun run dev` with the real database: simple reads 0.43 to 0.59 s (from 1.0 to 1.2 s); a chat's page arrives complete in 0.48 to 0.64 s to first byte, a library's in 0.7 to 1.0 s (its two reads are the slower kind, about 0.75 s each, run together); no skeleton and no hydration warning on either; view source holds the messages and files. A guest gets a public chat whole; a private chat, to a guest or another member, says "not found" with none of it in the source; the same for another member's library. After a fresh load of `/`, every menu page opens with no skeleton; so do the admin tabs once the user menu has been opened; a library opens with no skeleton after its card is hovered (from elsewhere it shows skeletons once). Rendered pages carry `private, no-store`, API routes and assets keep theirs. After `bun run typecheck` with dev running, dev answered from Postgres.

As built: `server/plugins/preparedStatements.ts` prepares only queries with parameters (those without already take one trip, and migrations stay unprepared), transactions included; `server/plugins/privatePages.ts`; `usePrefetch()` is shared by the layout, the sidebar, the user menu, the admin tabs and the library cards. Admin lists load when the user menu opens (one step before the Admin entry) and, for an admin, the other tabs' lists once an admin page is up.

### Findings

Measured on `bun run dev` against the real dev database.

| | Time |
|---|---|
| One trip to the database | 0.22 to 0.31 s |
| One query with a parameter | 0.44 to 0.61 s: two trips |
| A simple read (`/pins`: the user lookup, then one query) | 1.0 to 1.2 s |
| The same read in a trial with prepared statements | 0.45 to 0.6 s |
| A chat with its lanes and messages, same trial | 0.48 to 0.58 s |
| A click to a page whose data is in the browser already | 0.15 s, no skeleton |

- **Two trips per query.** Drizzle calls postgres-js with `prepare: false`. postgres-js then asks the database to describe the query (one trip) before it runs it (a second). A query without parameters takes one trip. O2 and O3 were measured with a delay added per query on the local database, which counts queries, not trips, so this never showed.
- **Clicks inside the app never go through the server render.** Whether a click shows a skeleton depends only on whether the data is in the browser. Today that holds for the chat list, folders, pins, models and model profiles; every other page loads on its first click of a visit, and again after ten unused minutes.
- **Nuxt's route rules do not fit signed-in pages.** `prerender`, `swr` and `isr` store a page and reuse it for the next visitor; here every page's HTML carries the signed-in user and a per-session CSRF token. `ssr: false` sends an empty page and moves the role gate to the browser. So the choice per route is only whether the server waits for that page's data.
- **Pages carry no `Cache-Control` header**, so a proxy between the app and a browser may store a member's page.
- **`bun run typecheck` while dev runs moved the dev server to the local database** (PGlite), most likely as the comment in `nuxt.config.ts` warns: it loads no `.env.dev`. Seen once, during these measurements.

### Which pages wait for their data

| Route | Opened by | The server waits for | Why |
|---|---|---|---|
| `/chat/:id` | members, people it is shared with, guests when link access is on; from links, bookmarks, reloads | the chat with its lanes and messages | the conversation is the page; a guest gets it in one response; the title is in `<title>` again |
| `/libraries/:id` | members with access; from links other members send | the library and its file list, together | the files are the page |
| `/` | members, the usual entry | nothing | nothing to read before typing |
| `/characters`, `/libraries`, `/model-profiles`, `/structure-profiles`, `/shared`, `/settings` | members, by a click | nothing | reached from the menu, where the data is in the browser by then; a reload shows skeletons once |
| `/admin/*` | admins and moderators, by a click | nothing | the same; the catalogs are large and load in the browser |
| `/temporary` | members | nothing | its chat lives only in the browser |
| `/signin` | signed-out visitors | nothing | reads no data |

A page that waits sets `enabled: true` on its own query. Everything else on it (votes, preferences, the sidebar's lists) stays lazy, so the server makes one request for the page, not one after another.

### What keeps it safe

- The server reads through the same API routes, with the visitor's cookie (`useRequestFetch`). The page cannot hold more than the API gives that visitor; a guest gets what link access allows, and "not found" otherwise.
- No page is stored and reused: no caching route rules, and `Cache-Control: private, no-store` on every rendered page.
- The role gate (`auth.global.ts`) runs on the server before anything renders; the API checks again.
- Reads return no secrets: `/users/me` names which keys are set, `/admin/settings` says `hasKey`.

### Work

- **One trip per query.** A server plugin makes the postgres-js client prepare what Drizzle sends (it wraps the client's `unsafe` to pass `prepare: true`). After a query's first use on a connection it takes one trip. It applies only while the client's own `prepare` option is on, so a database behind a transaction-mode pooler turns it off with `hub.db.connection.prepare: false`; PGlite has no such client and is left alone. Queries inside a transaction use the transaction's client: covered the same way if that is a few lines, else they keep two trips. Ceiling: statements stay per connection until postgres-js recycles it (30 to 60 minutes by default); a query over a list of varying length (`inArray`) counts once per length.
- **Pages that arrive with their data**, per the table.
- **Lists in the background.** Once the first page is up and the browser idle (`onNuxtReady`), the layout loads what the menus lead to: libraries, characters, structure profiles, shared chats, the member's profile and usage. Admin lists (settings, users, invites) load when pointer or focus reaches the Admin entry; a library when its card is hovered or focused, as chats do. Unused data is kept an hour instead of ten minutes.
- **`Cache-Control: private, no-store`** on rendered pages, from Nitro's `render:response` hook, so assets and the API keep their own headers.
- **`typecheck` loads `.env.dev`** (`nuxt typecheck --dotenv .env.dev`), so it writes the same database driver as dev.

| # | Work | Done when |
|---|---|---|
| O6 | The five items above | on `bun run dev` with the real database: `/pins` answers in about 0.5 s (from 1.1 s); a reload of a chat and of a library arrives complete, with no skeleton and no hydration warning, and view source holds the messages; a guest gets a link-shared chat the same way, and a private chat's address gives "not found" with none of the chat in the source; after a fresh load of `/`, a click on each menu page shows its data with no skeleton; page responses carry `private, no-store`; after `bun run typecheck` with dev running, dev still answers from Postgres |

### Not in O6

- **The user lookup alongside the page's read** (one trip per read, about 0.3 s): every handler would start its read from the session's user id. A larger change; next if 0.5 s is still too long.
- **The `node-postgres` driver**, which sends "describe" and "run" together: one trip with nothing kept, at the price of a dependency and a driver change.
- **Waiting up to a time limit** and sending whatever is ready. Production's place is undecided; next to its database a trip is a few ms and every page could arrive with its data at no visible cost. Widen the table then.
- **A chat's title in `og:title`**: link previews show the site name on every page, as before.
