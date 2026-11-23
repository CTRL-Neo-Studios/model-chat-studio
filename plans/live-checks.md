# Live checks: closing what earlier milestones left open

Status: done (2026-11-22). One phase. Changed no feature: it extended the smoke scripts, ran them against `bun run dev` with the dev database's instance keys, and recorded the results in the plans they close (results at the end).

## 1. What is open

| Item | Recorded in | What it asks for | Covered today by |
|---|---|---|---|
| 2.5 live run | milestones 2–4 plan, phase 2.5 ("Built; waiting for the live run") | two lanes answering one message at once, on a real platform, with the limits in place | the "two models" step of `scripts/app-smoke.ts`, never run against this instance |
| 4.4 live run | milestones 2–4 plan, status line | on both platforms, the model lists, searches and reads a library file it was not given, next to web search; spike D's English and Chinese questions still find their files | the index part by `test/search.test.ts` (PGlite); the tools only against a scripted model |
| Group chat, repeatable | milestones 5–6 plan, 6.2 to 6.4 | a round in the decided order, the second speaker reading the first's answer | the 6.4 live run, by hand; the 66-case decision battery was a throwaway route |
| Stale status lines | milestone 1 plan ("Phase 4 is next", "live checks wait for API keys"), milestones 2–4 plan, optimization plan ("milestone 2 waiting for its live smoke run") | true statuses | — |

Not open, despite what I said before this plan: an edit keeps a message's `data-mention` parts (6.3 added them to what `editMessage` keeps beside the "@" references).

## 2. Decisions

| Topic | Decision |
|---|---|
| Where the checks live | `scripts/app-smoke.ts` gains steps; the decision battery becomes `scripts/decision-battery.ts`. Both stay, for any later live run (a deploy included). |
| What they run against | `bun run dev` with the dev database (both instance keys stored, DeepSeek active). `app-smoke.ts` switches the platform per run and back, as now. |
| Who runs them | I run them, signed in through a throwaway session route that is deleted afterwards; you can run them later with your own session cookie, as the README says. |
| Pass rule for model-driven steps | A step passes when the behaviour is visible in what the app stored or streamed (tool calls, sources, the trace of the second speaker), not on wording. The decision battery passes at 95% or more; it prints every miss. |
| Cost | Both platforms, `--search` included: about $0.05 (OpenRouter search is most of it). The battery: 66 calls at about $0.00003. |

## 3. Phase L: the checks, the runs, the record

`scripts/app-smoke.ts`, new steps per platform, after "two models":

- **Library tools (4.4).** Creates a library with a note, `project.md`, whose last line holds a made-up codename, and no tags (auto-fetch matches tags by default, so it leaves the note alone). Attaches it to the chat and asks for "the codename on its last line" of "the project note in this chat's library". Passes when the stream holds a `list_files` or `search_files` call and a `read_file` call, and the answer holds the codename. With `--search`, the same message also asks a current question with web search on, and the step also needs at least one source: tools and search in one answer. Deletes the library. Spike D's Chinese and English questions stay with `test/search.test.ts`: the index is built in the app and queried with the same SQL on PGlite and Postgres, so a live run adds nothing there; `search_files` here runs that SQL on the real database. The shared client (session, CSRF, calls, stream reading) moved to `scripts/smoke-client.ts`.
- **Group round (6.2 to 6.4).** Creates a group chat with two lanes of the same model, named Engineer and Designer, Designer first in lane order, and asks `POST /chats/:id/speakers` about "Engineer, solve this: what is 17 × 23? Designer, put the Engineer's result in one sentence afterwards." Passes when the order is Engineer, Designer (reported with the step that chose it: the decision model if one is set, else names), each answers in turn through the turn route, the round's saved `speakers` are Engineer then Designer, and the Designer's turn trace (`GET /chats/:id/overview`) holds the Engineer's answer as a user message. Deleted with the chat.
- **Stream parsing** gains tool calls (`tool-input-available` chunks, by tool name), for the library step.

`scripts/decision-battery.ts`: spike G's messages (the brief's sentence in two forms, "Designer, please go after the Engineer", "Everyone but the Architect", "What do you all think?", "Go on.") against two and three participants in both lane orders, three times over. As built, it asks a running instance's `POST /chats/:id/speakers` (with `SESSION`, like `app-smoke.ts`) instead of calling the Decisions API with `OPENROUTER_API_KEY`: the stored key is used, nothing needs decrypting, and the route's own reading and order rule are measured with the wording. It sets the decision model for the run (`--model`, default `typesafe/jev-1.14`) and puts the setting back; it waits 3.1 s between calls, as the route allows 20 a minute. A case passes when the step that chose was the decision model with the expected order, or, for "Go on.", when the decision model chose nobody. Prints every miss; exits non-zero below 95%.

README: the new steps and the battery under "Smoke runs".

Then, in the same phase:

- `bun scripts/app-smoke.ts --search` on both platforms, and the battery.
- A failure is fixed here if the cause is the app; a model that answers badly is recorded, not worked around.
- The results go where the items were opened: the 2.5 row and the status line of the milestones 2–4 plan, the 6.x notes of the milestones 5–6 plan (the battery as the repeatable check), and corrected status lines in the milestone 1 and optimization plans.

| # | Work | Done when |
|---|---|---|
| L | The two `app-smoke.ts` steps, tool calls in its stream parsing, `scripts/decision-battery.ts`, README; the live runs and the record | typecheck and lint clean; on `bun run dev`, both platforms: every `app-smoke.ts --search` step passes, or its failure is explained and fixed or recorded; the battery scores 95% or more; the four plans' status lines say what is true |

## Results (2026-11-22)

`bun scripts/app-smoke.ts --search` on `bun run dev` with the dev database, DeepSeek active before and after: every step passed on both platforms.

| Step | OpenRouter (`deepseek/deepseek-v4.1-flash-1017`) | DeepSeek (`deepseek-flash`) |
|---|---|---|
| first turn, image and PDF, regenerate | "pong"; "pineapple, mango"; regenerated in place | the same |
| two models (2.5) | "pong" and "second", one user message saved | the same |
| library tools (4.4) | `list_files`, `read_file`; the codename; 15 web sources in the same answer ($0.022, mostly search) | `list_files`, `search_files`, `read_file`; the codename; 3 web sources ($0.0017) |
| group round (6.x) | by names: Engineer "17 × 23 = 391", then Designer restating the Engineer's 391; the Designer's trace held the Engineer's answer | the same ("The Engineer's calculation gives 17 × 23 = 391") |
| web search | Nuxt 4.6.4, 5 sources | Nuxt 4.6.4, 0 sources: DeepSeek sometimes answers from search without a citation (milestone 1, section 10) |
| dictation, ledger, delete | the sentence heard; $0.0307 recorded; 404 | the sentence heard; $0.0036 recorded; 404 |

`bun scripts/decision-battery.ts` (`typesafe/jev-1.14`, three rounds): 66 of 66, about 5 minutes; the setting was put back to empty.

Nothing failed, so nothing in the app changed. The run's chats and library were deleted by the scripts.

## 4. Not in this plan

- Deployment (Vercel, where the database lives, storage, limits across instances): its own plan, once you have chosen where the database goes.
- Checks in CI: they spend money and need keys.
