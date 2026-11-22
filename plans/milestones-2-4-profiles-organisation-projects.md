# Milestones 2–4: model profiles, organisation, projects

Status: milestones 2 and 3 done. Milestone 4: 4.P spikes done (all live runs passed; spike A found DeepSeek refuses app tools next to web search with thinking off, fixed in the turn route); 4.1 done (the project description is set through the API only; the page has no field for it yet); 4.2 done ("Add to project" sits in the conversation overview's Files tab; "@" in a chat is offered to its owner); 4.3 done; 4.4 next. Milestone 1 (`plans/milestone-1-chat-foundation.md`) is the base; its conventions (section 2 there) apply unchanged.

Goal, in build order:

- **Milestone 2, model profiles and multi-model chat.** A chat answers with one to four "lanes", each a copy of a model profile. Per-message actions that do not truncate. A model browser.
- **Milestone 3, organisation.** Chat folders, temporary chats, the memory slider, chat commands, the conversation overview.
- **Milestone 4, projects.** File spaces, "@" references, auto-fetch, file tools, context engineering profiles, project sharing.

Profiles come first because they change the turn pipeline, and everything after builds on it.

## 1. Decisions

| Topic | Decision |
|---|---|
| Model per chat | A chat no longer points at a model. It holds lanes (`chatModel` rows), each an editable in-chat copy of a model profile. A single-model chat is a chat with one lane. |
| Lane edits | Changes made in a chat stay in the chat. "Apply to profile" writes a lane back to the profile it came from. |
| Multi-model context | Each lane has its own thread: every user message, plus that lane's own answers. It never sees the other lanes' answers. |
| Models at once | At most `maxChatModels` enabled lanes per chat, an admin setting, default 4. Each answer is billed and rate-limited separately. |
| Regeneration cap | `maxRegenerations` per answer, an admin setting, default 50. |
| Automatic retries | `maxRetries`, an admin setting, default 5: how often the server retries a model call that failed before any text arrived. |
| Profile ownership | Personal, plus instance profiles an admin publishes. Members use or copy instance profiles, and cannot edit them. Same rule for context profiles. |
| Message actions | Regenerate one lane's answer, delete one message, edit an answer's text, edit a user message. None of them drops what follows. "Save and resend" keeps today's truncating edit. |
| Answer layout | Side by side or stacked, a per-chat switch. |
| Folders | Nested, per member. Dragging moves a chat or a folder into a folder. Order inside a folder is not manual: folders by name, chats newest first. |
| Temporary chat | Stored on the server with a `temporary` mark: hidden from the sidebar, deleted when the page is left or refreshed, swept after 24 h. "Keep this chat" clears the mark. |
| Memory slider | How many messages of a lane's thread are sent, counted without answers that are reasoning only. Rightmost means all. Lowest is 1. |
| Commands | `/compact`, `/clear`, `/temp`, `/rename <title>`. |
| `/compact` | Summarised messages stay readable above a divider and are no longer sent. |
| "@" and "/" in the prompt | Nuxt UI's own pattern: `UEditor` in `UChatPrompt`'s `#body` slot with two `UEditorMentionMenu`s (`ChatPromptEditorExample`). No hand-built menu. |
| Project file retrieval | "@" references (always on), auto-fetch (per-chat switch), and file tools the model calls. No `tool_search` meta-tool: there are three tools. |
| Auto-fetch matching | Tags by default. A per-chat option adds a Fuse.js search over names and text content. |
| Auto-fetch scope | The whole file space, or chosen folders (recursive), per chat. |
| Context profiles | Used in projects only: a project has a default, a project chat can override it. |
| Project sharing | Roles per listed member: `viewer` (reads), `member` (also starts chats), `editor` (also edits the file space). |
| Project chats | Private to their author by default. The author can mark a chat "visible to the project". A project chat can also be shared on its own like any chat, and then carries a "part of project X" badge. |
| Chat uploads in a project | Chat-only by default, with "Add to project" later. |
| Pins | Per member (`pin` table: kind, target id): chats, chat folders, model profiles (instance ones too) and projects. A pinned item comes first among its siblings; loose chats get a "Pinned" group above the dates. Project chats and their folders are chats and chat folders, so 4.2 gets pins for them as they are. A pin left by a deletion is ignored. At most 200 per member. |
| List pages | Model profiles and projects are card grids. Admin pages stay tables. |

## 2. What changes underneath

Three structural changes carry all three milestones. Each lands once, in the milestone named.

### 2.1 Lanes (milestone 2)

`chat.params.model` and `chat.systemPrompt` move into `chatModel` rows. What stays on the chat is what applies to every lane: `chat.settings` (`webSearch`, `answerLayout`, later `memoryLength`, `autoFetch`, `fileTools`).

The client runs one AI SDK `Chat` instance per lane. That instance's message list is exactly the lane's thread, which is the context rule above, so no second bookkeeping is needed. Sending creates one user message id and submits it on every enabled lane: N parallel `POST /chats/:id` requests, one per lane. One request per answer keeps the existing stream, abort, usage and budget code as it is.

### 2.2 Turns instead of a flat list (milestone 2)

Today messages are ordered by `seq` and an edit or regenerate deletes everything after. In-place regenerate and single-message delete break that: a regenerated answer gets a new `seq` but belongs to an old question.

New rule: `message.parentId` is structural. An answer's parent is the user message it answers (already true for stored rows). Display order is top-level rows (user messages, summaries) by `seq`, each followed by its answers in lane order. `message.chatModelId` (new column) names the lane.

Truncation leaves the turn route. `POST /chats/:id` only ever adds or replaces one answer. Editing and deleting are message routes.

### 2.3 One context builder (milestones 3 and 4)

`buildContext()` in `server/utils/chat/context.ts` turns (chat, lane, target user message) into an ordered list of blocks, then into model messages. Every feature below is one stage of it, and the block list is what the overview shows.

| # | Stage | From |
|---|---|---|
| 1 | Instructions: the lane's system prompt, or the default instructions when it has none; web search instructions when search is on | M2 |
| 2 | Thread: the lane's latest summary if any, then the messages after it, cut to the memory length | M2 (thread), M3 (summary, cut) |
| 3 | "@" references in user messages, expanded where the message stands | M4 |
| 4 | Context profile blocks before and after the thread | M4 |
| 5 | Auto-fetched files as one added user-role message at the end, or at the profile's auto-fetch block | M4 |
| 6 | Tools: chart, the platform's web tools, file tools | M4 (file tools) |

From milestone 3, each answer stores its block list in `turnTrace`: block kind, role, label, size, and either the text (prompts, small) or references (message ids, file ids and names). Files and history are not copied.

## 3. Milestone 2: model profiles and multi-model chat

### Schema

| Table | Columns of note |
|---|---|
| `modelProfile` | `id`, `ownerId` FK cascade, null for an instance profile; `name`, `color`, `platform`, `modelId`, `systemPrompt` (null: default instructions), `params` jsonb. Migration `0004_model_profiles` (phase 2.3), which also adds `chatModel.profileId` |
| `chatModel` | `id`, `chatId` FK cascade, `position`, `enabled`, `name` (null: the model's name), `color` (a Tailwind palette name), `platform` and `modelId` (both null: the active platform's default model; the platform is stamped by the server when a model is chosen), `systemPrompt`, `params`. `profileId` FK set null comes with `modelProfile` in phase 2.3 |
| `chat` | `params` becomes `settings` jsonb (not null, `{}`); `systemPrompt` is dropped |
| `message` | adds `chatModelId` uuid, FK set null |
| `setting` | adds `maxChatModels` (default 4), `maxRegenerations` (default 50), `maxRetries` (default 5) |

`params` is one zod schema in `shared/`, `modelParamsSchema`: `providers`, `allowFallbacks`, `providerSort` (`price`, `throughput`, `latency`), `zdr`, `temperature`, `topP`, `topK`, `minP`, `topA`, `frequencyPenalty`, `presencePenalty`, `repetitionPenalty`, `maxOutputTokens`, `reasoningLevel`.

- A control shows only when the model's `supportedParameters` lists it, as today. On DeepSeek that leaves temperature, top-p and max tokens: `@ai-sdk/deepseek` drops penalties, top-k and seed.
- `topK`, `frequencyPenalty`, `presencePenalty` and `seed` are standard `streamText` settings. `min_p`, `top_a`, `repetition_penalty` and `provider.sort` / `provider.zdr` go in `providerOptions.openrouter`, which the provider spreads into the request body as is; no `extraBody` (spike C, wire capture).
- Support varies widely: of 476 OpenRouter models, 225 list `top_k`, 117 `min_p`, 158 `repetition_penalty` and 17 `top_a` (spike C, 2026-11-21). A model's list is the union over its providers, so a setting can be dropped by the endpoint that serves the turn. The editor shows a lane's provider-dependent settings with that note; `require_parameters` is not sent, since it fails the turn when no single endpoint takes them all.
- `MessageMetadata` adds `lane` (`name` and `color` at the time of the answer, so an answer keeps its label after its lane is deleted), `durationMs`, `edited`, `attempt`.

Migration (`0002_chat_lanes`, phase 2.1): every chat gets one lane from its `params` and `systemPrompt`; existing answers get that lane's id. A chosen model's platform comes from the chat's last answer, else the active platform; a chat without a model gets a lane with neither. `test/migrations.test.ts` seeds the old schema and checks the result.

A lane whose platform is not the active one is shown as unavailable and skipped. If no lane is available, the platform's default model answers, which is today's fallback rule.

### API

| Route | Purpose |
|---|---|
| `GET /model-profiles`, `POST /model-profiles` | own and instance profiles; create from `{ modelId }` alone (quick add, named after the model) or in full. `instance: true` is admin only |
| `PATCH /model-profiles/:id`, `DELETE /model-profiles/:id` | owner; admins for instance profiles |
| `POST /chats` | takes `models`: lane fields in order (1 to 12 until `maxChatModels` in 2.5), and `settings`. `{ profileId }` comes in 2.3 |
| `GET /chats/:id` | adds `models` (the lanes) and `settings` |
| `POST /chats/:id/models` | add a lane at the end, from lane fields or `{ duplicateOf }` with fields applied on top (phase 2.1); `{ profileId }` in 2.3. Deleting the last lane is refused |
| `PATCH /chats/:id/models/:laneId`, `DELETE …` | any lane field and `enabled` (phase 2.1); `position` with the reorder UI in 2.4. Delete leaves its answers in place |
| `POST /chats/:id/models/:laneId/apply` | write the lane back to its profile. Built with its button in 2.4 |
| `POST /chats/:id` | body gains `chatModelId` (below) |
| `PATCH /chats/:id/messages/:messageId` | a user message: `parts`, optional `dropAfter: true` ("Save and resend"). An answer: `text`, sets `metadata.edited`. A message with attachments still cannot be edited |
| `DELETE /chats/:id/messages/:messageId` | an answer alone; a user message with its answers. Attachments go with it |
| `GET /models` | adds `outputModalities` per model and `maxChatModels` |
| `GET /admin/settings`, `PATCH …` | add `maxChatModels`, `maxRegenerations`, `maxRetries` |

### One turn, per lane

Body: `{ trigger: 'submit-message', message, chatModelId }` or `{ trigger: 'regenerate-message', messageId, chatModelId }`.

- `submit-message`: the first lane request to arrive inserts the user message. The others join it: same id, same chat, unchanged, the newest user message, and not yet answered by that lane. Anything else is 409; edits are the message route.
- `regenerate-message`: answers the target answer's question again (it must be this lane's answer), or the target user message, or without a target the newest user message. The model sees the lane's thread up to that question. Nothing is deleted before the call: `saveAnswer` replaces the lane's earlier answer to that question when the new one is saved, so a failed turn keeps the old answer. A stopped one follows the member's preference `stoppedRegenerate` (`user.preferences`, migration `0003`, `PATCH /me/preferences`, a "Chat" card on `/settings`): `keep-previous` (the default) keeps the earlier answer, `keep-partial` saves what streamed. A first answer that is stopped is saved either way. The new answer's `metadata.attempt` is the old one's plus one; past `maxRegenerations` regenerations the request is refused with 429 (phase 2.5).
- Reading order: each user message in `seq` order, followed by its answers in `seq` order, so an answer regenerated later stays under its question (`listChatMessages` sorts by the question's `seq`).
- `maxRetries` is passed to `streamText`, which retries retryable platform errors (rate limits, 5xx) until the stream starts. The SDK's default is 2. The SDK backs off exponentially from 2 s, so a call that fails three times takes about 14 s before it answers; the card shows "Thinking..." meanwhile.
- The first enabled lane (by position) generates the title, so N lanes make one title call. This also covers a chat started on the home page, whose first answers are regenerate requests that insert nothing.
- History is the lane's thread: user messages in `seq` order, each followed by this lane's answer if it has one. A lane added late sees earlier questions without answers, so the thread can hold consecutive user messages; they are sent as they are (spike B: accepted by every model tried).
- Enabled lanes are counted against `maxChatModels` when a chat is created, when a lane is added or turned on (400 past the limit), and here: when an admin lowers the limit, only the first enabled lanes by position answer. The models menu turns off "Add model", Duplicate and turning a lane on at the limit (`GET /models` reports `maxChatModels`).
- Budget, rate limit, usage ledger and attachments work per request, unchanged.

### Frontend

- `useChatLanes(chat?)` replaces `useChatSettings`: the lanes and the chat's shared settings, with add (from a profile or a model id), duplicate, update, remove, move (two lanes swap positions), apply to profile and settings changes. On a saved chat each change is sent at once; on a new chat the lanes are drafts with client-made ids until `POST /chats`. The home page restores the last chat's lanes from the `chat-lanes` cookie (profile or model ids only) and its settings from `chat-settings`; `/?profile=<id>` starts from that profile alone.
- `useLaneAnswers` streams answers, one request per lane, into one message list. Plan change (phase 2.4): no AI SDK `Chat` instances at all. Spike A showed `chat.regenerate()` cuts later messages, and once regenerating needed `transport.sendMessages()` with `readUIMessageStream()`, sending works the same way: `send()` adds the user message and starts every enabled lane, `regenerate(lane, question)` answers one again; each answer replaces that lane's earlier answer under its question in place. Pending answers are tracked per question and lane (submitted, streaming, error with Retry and Dismiss); `stop()` aborts one or all. Answers carry `chatModelId` and `parentId` (`listChatMessages` returns both).
- The page renders each user message, then its answers: plain as before while the chat has one lane and the question one answer, else one card per lane in lane order (answers of removed lanes last, labelled from `metadata.lane`). Card header: color and lane name, with a stop button while writing. Footer: model, tokens, cost, time (`metadata.durationMs`) and the per-answer actions. Side by side is a horizontally scrolling row of cards at least 20rem wide; stacked is a list (`chat.settings.answerLayout`).
- `chat/ModelsMenu` in the navbar beside the title: a `UDropdownMenu` of the lanes with a color chip. Each opens a submenu: Edit, Enable or Disable, Thinking mode (the reasoning levels), Color label, Duplicate, Delete. Below the lanes: "Add model" (profile picker, or pick a model id) and the layout switch.
- `chat/ModelEdit` modal: name and color, model (opens the browser), provider with sort and the zero-retention switch (OpenRouter only), system prompt as Default or Custom with a rough token count (characters ÷ 4, marked "~"), and a collapsible sampling section of sliders with number fields. Buttons: Apply to profile, Reset (back to the profile's values), Remove.
- `/model-profiles` (phase 2.3): Mine and Instance tabs, "Add model" (quick add through the browser), and per profile: Start a chat (`/?profile=<id>`), Edit, Copy to my profiles (instance profiles), Publish for everyone (admins, own profiles), Delete. Members see instance profiles read-only. Linked from the user menu.
- `ModelProfileForm` (phase 2.3), the edit form shared with the 2.4 lane editor: color swatch and name; model (`ModelField`, which opens the browser); reasoning; OpenRouter providers (the provider picker as a form field), ranking and zero data retention; system prompt as Default (the default instructions, shown read-only) or Custom, with a rough token count; a collapsible sampling section with only the settings the model lists.
- `ModelBrowser` modal (the QoL item, phase 2.3): a virtualized, searchable table of the catalog with name, id, input and output types, context length, max output and prices; filter by input type, sort by name, price or context. Used by quick add, the profile form, and the default and title model fields in `/admin/settings` (the speech-to-text field stays a text input: audio models are not in the text catalog). Pinned and recent tabs are left out.
- A custom system prompt replaces the default instructions (phase 2.3); web search instructions are added either way. Until 2.3 it was added after them. `DEFAULT_INSTRUCTIONS` lives in `shared/utils/instructions.ts` so the editors can show it.
- Message actions: regenerate (this answer), delete, edit answer, edit message with Save and "Save and resend".
- Removed (phase 2.4): `ModelSelect`, `SettingsPanel`, `useChatSettings`, and the model, provider and settings pickers in the prompt. `PromptMenu` keeps files and web search (shown when any answering model can search); reasoning moved to the lane menu. The prompt accepts images and PDFs when any answering model reads them.

### Phases

| # | Work | Done when |
|---|---|---|
| 2.P | Spikes in `../model-chat-studio-prep` (branch `prep/m2-spikes`, `scripts/spikes/m2/`), see section 6 | each assumption is confirmed or the plan is changed |
| 2.1 | Done. Schema, migration, lane routes, the turn route per lane, `chat.settings`. Until 2.4 the UI edits the first lane (`useChatSettings` patches it; cookie `chat-defaults`), and until 2.2 an edit or regenerate still truncates across lanes | an old-schema PGlite chat with a model, temperature, web search and a system prompt migrated to one lane and answered through it in Chromium (the fixture platform received its system prompt and web search instructions); switching the model in the prompt patched the lane; a home-page chat was created with its lane and titled; over HTTP, two lanes answered one message in parallel (one user message, two answers), a disabled lane got 400, another chat's lane 404, the last lane could not be deleted. Tests cover the join rule (each condition mutation-checked), the lane thread and the migration |
| 2.2 | Done. `PATCH`/`DELETE /chats/:id/messages/:messageId` (`editMessage`, `deleteMessage`), in-place regenerate (`saveAnswer`), truncation out of the turn route; on the page, regenerate through `transport.sendMessages()`, Edit and Delete on answers, Delete and "Save and resend" on questions, "edited" in the answer footer | in Chromium against a fixture platform, on a three-turn chat: regenerating the middle answer streamed in its place and the fixture received only the turns up to it; an answer edited by hand (footer "edited"); a question edited without resend kept its answer; the last answer deleted through the confirm dialog; "Save and resend" on the second question dropped what followed and answered the new text; a question deleted with its answer; all still so after a reload. A regenerate stopped partway aborted the platform call and kept what had streamed. Tests cover reading order, regenerate targets, replacement per lane, edit with and without `dropAfter` (including an answer regenerated after later turns), answer edits keeping other parts, deletes and attachments; ordering, per-lane replacement and the `dropAfter` question set were mutation-checked |
| 2.2a | Done. The stop preference above | in Chromium against a fixture platform: with the default, stopping a regenerate partway left the previous answer on screen and in the database; after choosing "Keep what was generated" on `/settings`, a stopped regenerate replaced it with the partial answer. A test covers `saveAnswer` with `keepPrevious` |
| 2.3 | Done. Profile routes and abilities, `/model-profiles`, `ModelBrowser`, `ModelProfileForm`, lanes from profiles (`POST /chats` and `POST /chats/:id/models` take `profileId`), the extra sampling settings end to end, admin model fields use the browser | in Chromium against fixture platforms: an admin quick-added a profile through the browser (search, sort), edited it (color, name, reasoning, ranking, a custom system prompt, temperature and top K by keyboard), and published it; a member saw it under Instance with only Start a chat and Copy, got 403 editing it or publishing one, and started a chat from it: the lane copied the profile and the platform received the model, temperature 0.7, top_k 5, reasoning high, provider sort price, and the pirate prompt in place of the default instructions. The admin's default model was set through the browser. Tests cover profile abilities, lanes from profiles (own, instance, someone else's refused, fields on top) and the OpenRouter request fields |
| 2.4 | Done. `ModelsMenu`, `ModelEdit` (form, "Answers in this chat" switch, Remove, Reset to the profile, Apply to profile, Save), answer cards, both layouts, parallel streams with per-card and global stop, `POST /chats/:id/models/:laneId/apply`, lane `position` in `PATCH`, `metadata.lane` and `durationMs` | in Chromium against a fixture platform: on the home page a profile lane was added to the default model and the first message was answered by both side by side, each with its own settings (one at temperature 0.7 with high reasoning and a custom prompt); a third model added from the browser answered only the next message (its thread had both questions and none of the others' answers); "Apply to profile" after changing temperature to 0.5 updated that personal profile and left the published copy as it was; stacked layout; regenerating one card replaced only that answer; stop halted all three. A one-lane chat still reads as before |
| 2.5 | Built; waiting for the live run. `maxChatModels`, `maxRegenerations` (counted by `metadata.attempt`, 429 past it), `maxRetries`, a Limits card on `/admin/settings`, and a "two models" step in `scripts/app-smoke.ts` (a second lane with its own system prompt sends the same message at the same time; one user message is saved and each lane answers its way) | in Chromium against a fixture platform whose model fails twice in every three calls: limits set on the admin page (2 models, 1 regeneration); a two-model chat answered with no error shown while the fixture logged the 503s; "Add model" was off at two models; the first regenerate went through and the second showed "regenerated once, the most allowed" on the card, keeping the earlier answer. Tests cover attempts and the lane limit. Done when `scripts/app-smoke.ts` passes on both platforms live |

## 4. Milestone 3: organisation

### Schema

| Table | Columns of note |
|---|---|
| `chatFolder` | `id`, `userId` FK cascade, `parentId` self FK, `name`; from milestone 4 also `projectId` |
| `chat` | adds `folderId` FK set null, `temporary` boolean; `settings.memoryLength` (null: all) |
| `turnTrace` | `messageId` PK, FK cascade; `blocks` jsonb |
| `usageEvent.kind` | adds `compact` |

A summary is a `message` row with role `system`, `metadata.kind: 'summary'` and the lane's `chatModelId`. Its `seq` places the divider.

### API

| Route | Purpose |
|---|---|
| `GET /folders`, `POST /folders`, `PATCH /folders/:id`, `DELETE /folders/:id` | PATCH takes `name` and `parentId` and refuses a move into the folder's own subtree. Delete moves the folder's chats and subfolders to its parent |
| `PATCH /chats/:id` | accepts `folderId`, `temporary: false`, `settings` |
| `POST /chats` | accepts `temporary: true` |
| `GET /chats` | returns `folderId`; leaves temporary chats out; deletes the caller's temporary chats older than 24 h |
| `POST /chats/:id/compact` | per enabled lane: summarise its thread with its own model, store the summary, record usage as `compact` |
| `GET /chats/:id/overview` | owner only, one request for the overview: the block lists of the chat's answers in chat order, every file in the chat, and the spend ledger's totals for the chat by kind |

### Behaviour

- **Folders.** The sidebar becomes a `UTree`: folders first, then loose chats in today's date groups. Dragging uses native drag events on the rows (spike A): a row dropped on a folder moves into it, dropped on "no folder" moves out. Every drag has a "Move to…" menu twin for keyboards. Folder menu: New folder, Rename, Move to, Delete.
- **Temporary chat.** `/temporary` is the chat page without an id in the URL, so a refresh starts over by itself. The sidebar starts collapsed and is restored on leaving. Leaving the page deletes the chat: a `keepalive` DELETE on `pagehide` (refresh, closed tab, another site page) and on route leave (another page in the app); the 24 h sweep in `GET /chats` catches tabs that died. No title is generated and sharing is refused. The navbar shows "Temporary" and "Keep this chat", which clears the mark, titles the chat from its first message and moves to `/chat/:id`. Spend is recorded as usual.
- **Memory slider.** In the prompt footer, bottom left: "Memory: all" or "Memory: 12 messages". It counts the messages after the latest summary, without answers that are reasoning only; the summary itself is always sent, as a user message (the AI SDK takes system messages only as instructions). The cut never starts on an answer: an answer whose question was left out goes too, so the thread always opens with a user message (at most one message fewer than asked; this also makes spike D's outcome moot for the slider). Stored per chat and applied to each lane's own thread; saved when the slider is released or its popover closes.
- **Commands.** The prompt body is a `UEditor` (starter kit off, Enter submits, Shift+Enter breaks the line; on touch screens Enter breaks the line). What is sent is the editor's plain text, not its Markdown (spike B). "/" opens a `UEditorSuggestionMenu` whose custom kinds the parent runs. In a chat: `/compact` calls the route above; `/clear` opens a new chat with the same models and settings; `/rename` opens the rename dialog. On the new-chat page: `/temp` moves to a temporary chat with the same models and settings. Summaries show under a divider with one collapsible summary per model.
- **Overview slideover**, opened from the navbar, owner only:
  - *Trajectory.* One row per block and per event of each turn (instructions, context, user, fetched files, answer, tool call with its result), labelled by role and lane, with a timeline strip on top (input, model, tools) and a search field. Rows expand to the full text.
  - *Files.* Every upload and, in projects, every referenced file, with size, type and the message it belongs to. In a project chat each upload has "Add to project".
  - *Context.* Per answer: input, cached, output and reasoning tokens and cost as the platform reported them, the input split across blocks by size (an estimate, marked as one), and totals per lane and for the chat. A meter shows roughly what the next message would send against the model's context length.

### Phases

| # | Work | Done when |
|---|---|---|
| 3.P | Spikes, section 6 | as above |
| 3.1 | Folders: schema, routes, sidebar tree, drag and "Move to" | nested folders made, a chat and a folder dragged into another, a folder deleted with its content moving up; a move into its own subtree is refused |
| 3.2 | Temporary chat | a temporary chat with an attachment disappears with its blob on refresh and on navigation; a kept one appears in the sidebar; a stale one is swept |
| 3.3 | `buildContext()`, memory slider, `turnTrace` | the fixture platform receives exactly the last N messages for N = 1, 3, all; a trace row exists per answer |
| 3.4 | Prompt editor, the four commands, `/compact` | `/compact` on a two-lane chat stores two summaries; the next turn sends summary plus later messages; dictation, paste and attachments still work in the new prompt |
| 3.5 | Overview slideover | the three tabs match a known chat: blocks in sent order, files complete, token totals equal to the ledger |

## 5. Milestone 4: projects

### Schema

| Table | Columns of note |
|---|---|
| `project` | `id`, `ownerId` FK cascade, `name`, `description`, `contextProfileId` FK set null |
| `projectMember` | PK (`projectId`, `userId`), `role`: `viewer`, `member`, `editor` |
| `projectEntry` | one node of the file space: `id`, `projectId` FK cascade, `parentId` self FK cascade, `kind` (`folder`, `file`, `note`), `name` (unique within its folder), `tags` text[], `fileId` FK for a file, `content` text for a note (Markdown), `createdBy` |
| `contextProfile` | `id`, `ownerId` (null: instance), `name`, `blocks` jsonb |
| `chat` | adds `projectId` FK set null, `projectVisible` boolean, `contextProfileId` FK set null; `settings.autoFetch`, `settings.fileTools` |
| `chatFolder` | adds `projectId`: a project has its own folder tree |

`settings.autoFetch`: `enabled` (default on: with no tags in the project nothing matches, so it costs nothing until files are tagged), `maxEntries` (default 5), `scanMessages` (default 5), `scan` (any of `user`, `assistant`, `system`; default `user` only; three toggles in a `UToggleGroup`), `fuzzy` (default off), `folders` (entry ids; empty means the whole space), `maxChars` (default 60,000; images and PDFs count 0). Unset fields take `AUTO_FETCH_DEFAULTS`. Built: folders are never fetched themselves (a tag on a folder does nothing yet); the system prompt counts as the oldest text for ranking; fuzzy-only matches rank after tag matches; an entry the message already names with "@" is not fetched again; a new chat starts auto-fetch from the defaults, since folder ids belong to one project. The settings sit in a popover in the prompt's footer of project chats, saved when it closes.

Context profile blocks, an ordered array of at most 30:

| Kind | Content |
|---|---|
| `message` | `role` (`system`, `user`, `assistant`) and `text` |
| `history` | the chat's thread; exactly one, not editable |
| `autoFetch` | where auto-fetched files go; at most one. Without it they go at the end |
| `files` | file or folder paths in the project's file space, always included |

A profile is not tied to a project, so `files` blocks store paths, resolved in whichever project uses the profile. A path that does not resolve is skipped and flagged in the overview.

### How files reach the model

- **"@" references.** "@" in the prompt lists the project's files, notes and folders. A pick becomes a mention in the text and a `data-reference` part on the message (`entryId`, `name`, `kind`). At send time the server expands it where the message stands: text files and notes as `<file name="path">…</file>`, images and PDFs through the existing attachment path, a folder as everything under it. Content is read fresh on every turn, so the model sees the current file; the trace records what was sent. A deleted file leaves a note in the prompt.
- **Auto-fetch.** Scans the lane's thread: with `user` and `assistant`, the last `scanMessages` messages of those roles together; with `system`, also the lane's system prompt and the context profile's system blocks. System text does not change between turns, so a tag found there is fetched on every turn. A tag matches when it appears in the scanned text, case-insensitive; a tag of plain Latin letters and digits must match as a whole word, so `cat` does not match `category`. With `fuzzy` on, the words of the scanned text are also searched with Fuse.js over names, tags, notes and text files. Results are ranked by number of matching tags, then by how recent the matching message is, cut to `maxEntries` and `maxChars`, and limited to `folders`. They are sent as one user-role message after the conversation and never stored as a chat message. The answer's footer names the files that were fetched.
- **File tools.** `list_files({ folder? })`, `search_files({ query })` and `read_file({ path, offset?, limit? })`, on when the model takes tools and `settings.fileTools` is not off. They read text files and notes. They run with the chat author's access to the project. On DeepSeek with web search on and thinking off, no app tools are sent (chart included): DeepSeek refuses them there (spike A), and web search wins. The platform says so with `PreparedTurn.appTools: false`.

### Access

| | Owner | Editor | Member | Viewer |
|---|---|---|---|---|
| Read the file space and project-visible chats | yes | yes | yes | yes |
| Start chats in the project | yes | yes | yes | no |
| Add, edit, tag, move and delete files | yes | yes | no | no |
| Members, default context profile, rename, delete | yes | no | no | no |

- A project chat belongs to its author. Others in the project read it only when it is marked visible to the project, or through the chat's own sharing.
- Someone who reads a project chat through a link or a personal share, without being in the project, sees the "part of project X" badge and the names of referenced files, and cannot open project files.
- Each person's turns are paid from their own budget or key.
- When someone leaves or is removed, their chats in the project become ordinary chats.
- Deleting a project deletes its file space. The confirm dialog names the counts and lets the owner choose whether their own chats in it are deleted or kept as ordinary chats. Other people's chats are always kept.

### API

| Route | Purpose |
|---|---|
| `GET /projects`, `POST /projects`, `GET /projects/:id`, `PATCH …`, `DELETE …` | own and shared projects |
| `PUT /projects/:id/members/:userId`, `DELETE …` | owner: set a role, remove. A member can remove themselves |
| `GET /projects/:id/entries`, `POST …`, `GET /projects/:id/entries/:entryId`, `PATCH …`, `DELETE …` | the tree as a flat list (no note text); create a folder or a note; one entry with a note's text; rename, move, tag, edit a note; delete (a folder with everything in it). A name taken in the folder is a 409 |
| `PUT /projects/:id/files` | upload into a folder: same types and 8 MB limit as chat uploads |
| `POST /projects/:id/files/from-chat` | "Add to project": copies an upload of one of the caller's chats in this project to the top of the file space (a copy, so each side can be deleted on its own). Under `files/`, not `entries/`, so its path does not overlap `entries/:entryId` |
| `GET /chats`, `GET /folders` | return `projectId`: the sidebar shows the personal ones, a project's page its own. One cache each, so moves, renames and pins work the same in both places |
| `GET /projects/:id/chats` | 4.6: the project-visible chats of others (the caller's own come with `GET /chats`) |
| `POST /chats` | accepts `projectId` (refused with `temporary`). `POST /folders` accepts `projectId`; a folder, and a chat's folder, stay in their own tree |
| `PATCH /chats/:id` | accepts `projectVisible`, `contextProfileId`, `settings.autoFetch`, `settings.fileTools` |
| `GET /context-profiles`, `POST …`, `PATCH /context-profiles/:id`, `DELETE …` | own and instance profiles |
| `GET /files/:id` | also serves a project's files to the people in it |

### Frontend

- `/projects` lists projects. `/projects/:id` has Chats (the project's own folder tree and a prompt) and Files (a `UTree` with drag, upload, new folder, new note, tags with `UInputTags`). Notes are edited with `UEditor` and its toolbar.
- A project chat is the normal chat page with a project badge, "@" in the prompt, and a project section in the chat's settings: auto-fetch on or off, entries, messages scanned, roles, fuzzy, folders, file tools, context profile, visible to the project.
- `/context-profiles` lists profiles with Mine and Instance tabs. The editor is a sortable list of blocks: add a block, pick its kind and role, write its text, drag to reorder. Opened from a project, the `files` block browses that project's file space; opened on its own, it takes typed paths.
- The share dialog of a project: people with a role each. The share dialog of a project chat adds the "visible to the project" switch.

### Phases

| # | Work | Done when |
|---|---|---|
| 4.P | Spikes, section 6 | as above |
| 4.1 | Projects and the file space: schema, routes, pages, upload, notes, tags, drag | a project with nested folders, an uploaded PDF, a note and tags; entries moved by drag |
| 4.2 | Project chats, their folders, "Add to project", "@" references | the fixture platform receives a referenced note, a referenced folder's files and a referenced PDF in the message that names them |
| 4.3 | Auto-fetch and its settings | tests for the matcher (whole word, case, ranking, both caps, folder scope, roles); the fixture receives the fetched files as a final user message; off means none |
| 4.4 | File tools, and Postgres full-text search behind them and fuzzy auto-fetch: a stored, searchable text per note and text file (words split in the app with `Intl.Segmenter`, so Chinese is searchable; text files' text stored at upload, existing ones filled once), a `tsvector` with a GIN index, queried with `websearch_to_tsquery`; Fuse stays for typo-tolerant matching of names and tags | live on both platforms: the model lists, searches and reads a file it was not given, next to web search; spike D's English and Chinese questions still find their files through the index |
| 4.5 | Context profiles: routes, page, block editor, project default and chat override | the fixture receives the two example profiles from the brief block for block, in order |
| 4.6 | Sharing: roles, project-visible chats, the badge, abilities | each role checked against the access table with three accounts; a non-member with a chat link sees the badge and cannot open a project file |

## 6. To verify before building

Each milestone starts with these spikes. A failed assumption changes the plan before code is written.

Milestone 2:

- **Spike A, confirmed offline** (`scripts/spikes/m2/lanes-client.ts`): two `Chat` instances on one transport sent the same caller-chosen user id with their own lane ids, streamed at the same time (both 47–500 ms), each kept only its own thread, and `stop()` on one aborted only its request. `chat.regenerate()` on a middle answer cut the list from 6 to 4 messages; `transport.sendMessages()` with `readUIMessageStream()` replaced it in place (6 to 6, 6 streamed updates). Plan changed: regenerate path above.
- **Spike B, confirmed live** (`scripts/spikes/m2/consecutive-users.ts`, 2026-11-21): both SDKs send `user, user` and `user, assistant, user, user` unmerged, and every model tried answered both correctly: DeepSeek `deepseek-flash` with thinking off and on, and on OpenRouter `openai/gpt-oss-20b`, `anthropic/claude-haiku-5.5`, `google/gemma-3-4b-it`, `mistralai/mistral-nemo`, `meta-llama/llama-3.1-8b-instruct` and `deepseek/deepseek-v4.1-flash`. No merging is planned. Ceiling: a model whose template demands alternating roles would fail in a late lane; merging consecutive user messages in the thread is the fix if one turns up.
- **Spike C, confirmed live** (`scripts/spikes/m2/sampling-params.ts`, 2026-11-21): wire placement and support counts above. On `gryphe/mythomax-l2-13b` every setting together with `require_parameters` was accepted (served by Mancer 2). Pinned to each of its two endpoints, `top_k: 1` at temperature 2 gave the same text twice and the control without it gave different texts, on both `parasail/fp16` and `mancer/fp8`: `top_k` is applied. Each endpoint's greedy answer differs from the other's, which is why the first, unpinned run looked inconclusive.

Milestone 3:

- **Spike A, decided against `useSortable`, native drag confirmed** (throwaway page, Chromium, 2026-11-21). Nuxt UI's documented `useSortable` integration flattens the tree (`nested: false`) and reports only old and new indexes: it reorders, and folder order is not manual here, so "into this folder" would have to be guessed from a position. Native drag events instead: a `draggable` label in the `#item-label` slot, `dragover`/`drop` on the tree read the target row's folder. Dropped a chat into a folder, a folder with its content into another, a chat to "no folder"; a drop on a chat row and a drop of a folder into its own subfolder were refused. `sortablejs` is not added. To build: rows rendered as `div` (`:as="{ link: 'div' }"`), because Firefox does not drag elements inside a `<button>`.
- **Spike B, confirmed with one plan change** (throwaway page, Chromium, 2026-11-21). `UChatPrompt` `#body` with `UEditor` (starter kit off) and an Enter shortcut: Enter submits; Shift+Enter breaks the line; Enter while the "/" menu is open picks the item instead of submitting; pasted HTML (heading, bold, link, list) arrives as plain paragraphs; an Enter inside an IME composition (synthetic events) does not submit; text appended to the model (dictation) shows in the editor. Change: the `markdown` content type escapes what is typed (`**bold**` becomes `\*\*bold\*\*`, `<b>` becomes `&lt;b&gt;`), so the prompt reads `editor.getText({ blockSeparator: '\n' })`, which returned the text exactly with `\n` for line breaks. Commands use `UEditorSuggestionMenu` with custom `kind`s run by `UEditor`'s `handlers` (it deletes the typed `/comp` and calls the handler), not a mention menu, which would insert a `[@ label="compact" char="/"]` node. `/rename` opens the rename dialog rather than taking an argument. Not tested: a real IME and a phone; on touch screens Enter will break the line and the send button sends, since a phone keyboard has no Shift+Enter.
- **Spike C, confirmed** (throwaway route, 2026-11-21). A `keepalive` DELETE with the CSRF header, sent on `pagehide`, passed the CSRF check and arrived in Chromium on reload, on navigating to another site page and on closing the tab, and in Safari 27 on navigating away and on closing the window (Safari reload not driven: Apple Events JavaScript is off). Two gaps for the build: moving to another page inside the app fires no `pagehide`, so the page also deletes on route leave; a page left before it hydrated sends nothing, which the 24 h sweep covers.
- **Spike D, confirmed live** (`scripts/spikes/m3/thread-starts-with-answer.ts`, in the prep checkout). `system, assistant, user`, `system, assistant, user, assistant, user` and `system, user (summary), assistant, user` go on the wire unchanged and every model answered all three correctly: DeepSeek `deepseek-flash` with thinking off and on, and on OpenRouter `openai/gpt-oss-20b`, `anthropic/claude-haiku-5.5`, `google/gemma-3-4b-it`, `mistralai/mistral-nemo`, `meta-llama/llama-3.1-8b-instruct` and `deepseek/deepseek-v4.1-flash`. AI SDK v7 refuses system messages inside `messages` ("Use the instructions option instead"), so a stored summary (role `system`) is sent as a user message; this also answers milestone 4's "system-role messages after the first message" question.

Milestone 4:

Scripts in `scripts/spikes/m4/` of the prep checkout. They import the main checkout's platform code by relative path, because the prep checkout's is older.

- **Spike A, confirmed live with one restriction** (`app-tools-with-web.ts`). A function tool (`read_file`) goes on the wire next to the web tools on both platforms. With thinking on, DeepSeek `deepseek-flash` called it and answered from its result; so did OpenRouter `openai/gpt-5-mini` and `deepseek/deepseek-v4.1-flash`. With thinking off, DeepSeek refuses the request: "client tools can only be used together with `deepseek_web_search` in thinking mode". This already hits today's chart tool, which every turn sends: a DeepSeek lane with thinking off in a chat with web search on fails.
- **System-role messages after the first message: answered by milestone 3's spike D.** AI SDK v7 refuses them before anything reaches a platform. Context profile `message` blocks with role `system` are sent as user messages; system blocks at the very start are joined into the instructions.
- **Spike C, confirmed offline** (`reference-part.ts`). A `data-reference` part (`entryId`, `name`, `kind`) goes through the app's transport body unchanged, passes `userMessageSchema` extended with a reference part (a bad entry id is refused) and survives JSON storage. Left in, `convertToModelMessages` drops it silently. Its `convertDataPart` option expands one part where it stands, but returns one part only, so a folder (many files) cannot expand there. To build: expand references in the resolve step next to `resolveAttachments` (parts to parts, a folder to several), before `convertToModelMessages`.
- **Spike D, confirmed offline** (`fuzzy-search.ts`, 8 entries, 9 queries in English and Chinese). Usable with these settings, 9 of 9 as expected: words from `Intl.Segmenter` (Chinese has no spaces), dropping English stop words, Latin words under 3 letters and single Chinese characters; one Fuse query per word with `threshold: 0.2`, `ignoreLocation` and `ignoreFieldNorm`, keys name ×2, tags ×3, text ×1; an entry's rank is the sum of its word hits. Typos match ("deploymnt"); unrelated questions ("What is the weather like today?", "今天天气怎么样？") match nothing. At 0.3 the weather question already matched `sourdough.md`. Fuse's combined score must not be filtered again: with weighted keys an exact match in the text alone scores about 0.3. Ceiling: a small sample; a weak second hit (`部署指南.md` for "步骤", steps) ranks below the right one and is cut by `maxEntries`.
- **Spike E, confirmed live** (`autofetch-files.ts`). The added message `user(text + image_url + file)` brought back both secret words, at the end and before the question, on DeepSeek `deepseek-flash` (PDF by `file_id`) and OpenRouter `deepseek/deepseek-v4.1-flash`.

## 7. Ceilings and things left out

- Lane threads are loaded whole and cut in memory.
- The context split per block and the token counts in editors are estimates (characters ÷ 4). Totals are the platform's figures.
- Until 4.4, fuzzy search reads the project's text on each turn, capped per file. 4.4 replaces that with Postgres full-text search (see 4.4). Full-text search does not forgive typos in file text; Fuse keeps doing that for names and tags. `pg_trgm` would add it, but NuxtHub creates the local PGlite without extensions.
- File tools and fuzzy search do not read inside PDFs or images. Those reach the model through "@" and tags.
- "@" content is read fresh each turn, so an old turn's context can differ from what the trace recorded.
- Folder order is not manual.
- Temporary chats are not offered inside projects.
- No placeholders such as `{{user}}` in context blocks.
- A profile is tied to one platform's model id. After a platform switch its lanes are skipped until edited.
- Still out, as in milestone 1: branching, read-aloud, image generation, export and import, translations.

New dependency: `fuse.js` (already installed through Nuxt UI, made a direct dependency). TipTap comes with Nuxt UI.
