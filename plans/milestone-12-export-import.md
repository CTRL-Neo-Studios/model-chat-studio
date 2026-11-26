# Milestone 12: export and import of chats

Status: complete (2026-11-26): spike N and phases 12.1 to 12.4 built, the live run passed. Part of `roadmap-milestones-7-14.md`. No migration. Comes after milestones 8 to 11, so the file covers branches, versions, images and authors.

Goal: a chat can leave this instance and come back, or come in from OpenRouter's Chatroom.

## 1. Decisions

| Topic | Decision |
|---|---|
| A common format | There is none. The nearest thing everyone reads is a plain list of `{ role, content }` messages, which has no place for several models, branches, costs or files. So: one file of our own that loses nothing, and Markdown for reading. |
| Chat file | JSON, `{ format: "model-chat-studio.chat", version: 1, … }`: everything needed to make the chat again. Meant for moving a chat between accounts and instances, and for keeping. |
| Markdown | The branch that is showing, as a document: a heading per message with who wrote it, reasoning folded away, attachments by name. For reading and pasting; not importable. |
| What a chat file holds | Title, mode and settings; each model's lane with its name, colour, model, settings and the instructions it had (its own prompt, or its Character's name and instructions as text); every message of every branch and version with all its parts (text, reasoning, tool calls and results, sources, files) and what is recorded on it (model, cost, tokens, who answered, authors); the tree and which branch and versions were showing; votes. |
| Attachments | Optional: inside the file as data, or left as names. With them a chat file can be large. |
| What it does not hold | Libraries (their names only), Characters as Characters, the structure profile (its name and blocks as information), turn traces, the spend ledger. |
| Import | A chat file, or an OpenRouter Chatroom export. Always a new chat of yours, in a folder you pick; never merged into an existing chat. |
| What import makes | New ids throughout. A lane per model: a model this instance does not offer becomes the default model and keeps the lane's name. No Character is linked: a lane that had one gets its instructions as its own system prompt. Attachments go through the same type and size checks as uploads. Costs and models stay on the messages as history; no usage is recorded. |
| Trust | An imported file is untrusted input: it is checked field by field with size limits (25 MB, 5,000 messages, the message limits that apply to sent messages), nothing it names is fetched, and its text is shown as text. |
| Other formats later | A reader per foreign format turns it into a chat file; one path checks and writes. ChatGPT's or SillyTavern's export would be one more reader each. |
| All chats | One download of every chat you own, a chat file per line, without attachments. |
| Who may export | The owner. |

## 2. What changes underneath

- **`chatFile` schema** (`shared/utils/chatFile.ts`): the one description of the file, used by export, by import and by the readers.
- **Export** reads the whole chat (not the shown thread) and the lanes' Characters at that moment.
- **Import** writes a chat, its lanes, its messages with new ids mapped from the file's, and its files, in one transaction; stored files that an import fails after uploading are removed.
- **Readers** (`server/utils/chat/importers/`): `openrouter.ts` first.

## 3. API

| Route | Purpose |
|---|---|
| `GET /chats/:id/export?format=json\|markdown&files=true` | the file, as a download |
| `POST /chats/import` | a file (form field `file`) and an optional `folderId`; returns the new chat. The format is recognised from the content. |
| `GET /me/export` | every chat of yours, one chat file per line |

## 4. Frontend

- A chat's menu (sidebar and title): "Export…" with the format and "include attachments".
- "Import chat…" beside "New chat" and on a folder's page; after it, the new chat opens, with a note of what was changed (a model replaced, an attachment refused).
- `/settings`: "Export all my chats".

## 5. Phases

| # | Work | Done when |
|---|---|---|
| 12.P | Spike N, below | the mapping is written down, with what is lost |
| 12.1 | The chat file schema, export as JSON with and without attachments, export as Markdown | tests on a chat with two models, a branch, versions, a group round, an image and a PDF: the file passes its own schema and holds every message; the Markdown reads top to bottom as the page does |
| 12.2 | Import of a chat file | tests for the id mapping, the limits, a model that is not offered, a refused attachment, and a file that is not a chat file; round trip against a fixture: export, import, and the next answer's request equals the original chat's |
| 12.3 | The OpenRouter reader | tests on your sample (and any variants it has: several models, an attachment, reasoning); the imported chat reads as the Chatroom showed it |
| 12.4 | All chats in one download, a smoke step, the live run | the download holds one valid chat file per chat; live: a chat exported from one account imports into another and continues on each platform |

Built (12.1):
- `shared/utils/chatFile.ts`: `chatFileSchema`, the file's one description, `format: "model-chat-studio.chat"`, `version: 1`, with `CHAT_FILE_LIMITS` (25 MB, 5,000 messages). It holds the chat (title, mode, settings, the user's Character as text, the structure profile's name and blocks and the libraries' names as information), the lanes (position, on or off, name, colour, platform, model, system prompt, settings, the Character as text: name, instructions, examples, closing note), every message of every branch and version in the order written (role, parent, lane, whether it is the version shown, author by name, parts, metadata, time), the tip, votes, and attachments (name, type, size, the bytes in base64 when asked). Parts are described only by their type; import checks those it takes (12.2).
- `server/utils/chat/export.ts`: `exportChat` reads the whole chat, not the thread shown, with its lanes' and the user's Characters as they are now; the files of its messages (attachments, drawn images) are its attachments, their bytes read through a function the route passes. `chatMarkdown` makes the branch that shows into a document: the title and models, then a heading per message (the author; the lane's name and model), each user message followed by its answers in speaking order for a group round, else lane order, reasoning in `<details>`, attachments, library picks, charts and drawn images by name, other tool calls as "Used …", sources listed after.
- `GET /chats/:id/export?format=json|markdown&files=true`, the owner's: the file as a download named from the title.
- "Export…" in a chat's menu in the sidebar and under its title: a dialog with the two formats and "Include attachments" for the chat file.
- Tests: a chat with two lanes, a Character, an image and a PDF, a regenerated answer, a branch and a vote: the file passes its schema, holds all eight messages in order with the earlier version marked, the tip, the vote, the lanes with the Character as text, and the attachments with or without their bytes; its Markdown has the shown branch only, in page order, reasoning folded. A group round's Markdown follows `speakers`, not the order saved.

Check against the dev database: all eight of the admin's chats exported through the route with their attachments, each passing the schema (one carried its image), and as Markdown. In Chromium the title menu's "Export…" opened the dialog; Markdown downloaded as `Alpha reply.md`, reading as the page does.

Built (12.2):
- `server/utils/chat/import.ts`. `readChatFile` takes the file's text: not JSON, not `format: "model-chat-studio.chat"`, or not passing `chatFileSchema` is refused with 400, saying why. `importChat` checks that the file holds together (every parent an earlier user message, every lane named one the file has, no id twice, the tip a user message) and writes a new chat of the importer's in one transaction, with new ids for the chat, its lanes, messages and files.
- Parts are checked by kind: text, reasoning, files, sources, step marks, mentions, "@" picks and tool calls, each for the fields the app reads, at most 500,000 characters each, a user message's text at most 100,000 as for sent ones. Their other fields stay as they are, so the next turn sends what the original would (a reasoning part's provider data, for one). Parts of other kinds are left out and noted. An "@" pick becomes its name as text, since libraries do not come along.
- Lanes keep their model when it is on the active platform's list for the importer; otherwise the default model, the lane keeping its name (or taking the model's id as its name), without the settings that belong to the model (providers, reasoning level). A lane's Character comes as its own prompt (its instructions). Of each lane's answers to a message, one shows: the file's, else the newest. A round's `speakers` name the new lanes. User messages are the importer's; costs, models and tokens stay on the messages as history, and no usage is recorded.
- Attachments pass the upload checks (type and 8 MB) and are stored under new ids, linked to the first message that names them; a drawn image's tool call points at its new file. One that fails, or that the file left out, becomes the line "[Attachment not imported: name]", a drawn image's call an error. Stored files are taken back if the chat cannot be written.
- `POST /chats/import` (form field `file`, at most 25 MB, and `folderId`, one of the member's folders; 10 a minute) returns the new chat's id and notes: models not offered, Characters made prompts, attachments refused, kinds of parts left out, and the user's Character, structure profile and libraries left behind.
- "Import chat…" in the sidebar under "Temporary chat", and "Import a chat here…" in each folder's menu, on its page and in the sidebar: a file picker; the new chat opens, with the notes in a toast.
- Tests: the id mapping (new ids, the same tree, versions, tip, vote, metadata and reasoning's provider data, attachments as new files of the right message), a model not offered and a Character made a prompt, a refused attachment and one left out, the limits (a long text, a parent after its child, an unknown lane, 5,001 messages: refused and nothing written, stored files taken back), and files that are not chat files.

Round trip against a fixture (DeepSeek faked with reasoning): a chat of two lanes, an image, two rounds and a regenerated answer was exported with its attachments. The next message on the original and the same message on the imported copy's lane sent DeepSeek the same request, byte for byte (six messages, the image included). In Chromium the sidebar's "Import chat…" took the file: the new chat opened with both lanes, the image, the earlier version ("2/2"), and "Chat imported". The chats and the fixture's usage rows were deleted.

Built (12.3):
- `server/utils/chat/importers/openrouter.ts`: `openrouterToChatFile` makes a Chatroom export (`version: "orpg.…"`, with `messages` and `items` maps) a chat file. `readChatFile` recognises the format from the content and passes the result through the chat file's schema and the import's checks like any other; the route adds the reader's notes to the import's.
- Each model (character) is a lane, in the order added: its short name, `openrouter` and its model, its description as the lane's prompt, the sampling settings it has (`top_p` as `topP` and the rest by name), on unless disabled or removed. The models then go through the import's check, so on another platform the lanes keep their names on the default model.
- The user's messages follow one another in the order sent; each answer goes under its message in its model's lane, the newest of a model's answers to one message showing (a retry). An answer to a message the export lacks is left out and noted.
- Images and files a message carried as data URLs are attachments (`image-N.png` and the like). Reasoning comes as reasoning, sent encrypted it is left out and noted; `output_text` as text, its URL citations and the web searches' and fetches' sources as sources, each once. Cost as `costUsd`, `tokensCount` as `outputTokens`, the model that answered (`variantSlug`) as the model, an edited answer as `edited`. Items of other kinds are left out and noted.
- Shell calls (`openrouter:shell`) are a code block in the answer's text, each command with its output, and "# stopped before it finished" when one did not finish; not tool parts, as section 6 had it. The app runs no shell, and a call without its result, as a stopped answer leaves, makes a request no provider takes.
- `importChat` showed the first of a lane's answers to a message when the file marked none; it now shows the newest, as its comment said.
- Tests (`test/openrouterImport.test.ts`, an export made by hand in the samples' shape): two models, one with `top_p`; two images; an answer with reasoning, a citation and a web search, retried; a second message answered by both models, one with a shell call, encrypted reasoning and text, the other stopped in a call; an edited message; an item of an unknown kind. The file passes its schema with every lane, part, source, cost and note as above; imported, the shown messages read in the Chatroom's order, the first answer the earlier version, the images stored.

Check with the sample of 2026-11-25 on the dev instance (DeepSeek faked): "Import chat…" took the export as it was; the chat opened with DeepSeek and Kimi side by side, the shell calls as code blocks with their output, Kimi's stopped answer, cost on DeepSeek's, and the notes (encrypted reasoning, both models not offered on DeepSeek). The next message went to both lanes on the default model, each request plain text and the two images, without tool calls. The chat and the fixture's usage rows were deleted.

Built (12.4):
- `GET /me/export`: every chat the member owns, oldest first, temporary chats left out, one chat file per line (JSON Lines, `chats-YYYY-MM-DD.jsonl`), without attachments; written a chat at a time, so a long history is never held whole; a chat deleted while it runs is skipped. Three a minute.
- `/settings`: a "Your chats" card with "Export all my chats", a plain download.
- `scripts/app-smoke.ts`, step "export and import": the run's chat exported with its attachments, imported as a new chat, which answers the next message, and found in the all-chats download, every line of it a chat file; the copy is deleted.

Check against the dev database: the button on `/settings` downloaded `chats-2026-11-26.jsonl`, one line for each of the admin's eight chats, each passing `chatFileSchema` with the messages the chat has and its attachment by name only.

Live run (2026-11-26, both platforms with real keys, about $0.011 in all):
- `scripts/app-smoke.ts`: every step passed on OpenRouter and on DeepSeek. "Export and import" brought 14 messages and 2 attachments (the image and the PDF) across with no notes, and the copy answered "pong" on each platform; the download held 10 chats. Images were skipped (no image model chosen), read-aloud on OpenRouter too (not set up there).
- From one account to another: the admin's "Alpha reply" (an image, the default model) exported with its attachment and imported in Chromium by a member made for the run. On DeepSeek the member's copy answered "pineapple", the word in the imported image, which the member's session loads; with OpenRouter the active platform it answered the next question, "Black", as DeepSeek V4.1 Flash. The member, its chat, its file and its usage were deleted afterwards, the active platform set back to DeepSeek.

## 6. To verify before building

- **Spike N, the OpenRouter export.** From the sample you provide: which fields it has; how several models' answers to one message are stored and whether they map onto lanes; whether a retry or an edit leaves earlier versions in the file, and if so whether they map onto versions and branches; how attachments, reasoning and costs appear; which of its model ids exist here when OpenRouter is the active platform, and what a DeepSeek-only instance should do with them.

Spike N result (2026-11-25). The sample: the four newest exports in `~/Downloads` (October and November 2026), read for their structure only; you chose these, knowing they lack images, files, tool calls, several models and retries. The script is `model-chat-studio-prep/scripts/spikes/m12/openrouter-export.ts`; it prints structure and lengths, never what was written.
- **The file.** JSON, `version: "orpg.3.0"`, with `title`, `characters`, `messages`, `items`, and four `artifact…` maps (empty in every sample). The reader recognises it by `version` starting `orpg.` and `messages` and `items` being objects.
- **Models.** `characters` is keyed by id; each is one model (`model`, an OpenRouter id such as `anthropic/claude-fable-5.1`, with `modelInfo` holding its catalog entry and name), `description` (the system prompt; empty in all four), `samplingParameters` (empty in all four), `includeDefaultSystemPrompt`, `isDisabled`, `isRemoved`. Each sample has one. An answer names its model with `characterId`, so several models are several characters, each a lane here. [INFERENCE: not in the sample.]
- **Messages.** `messages` is keyed by id: `type` `user` or `assistant`, `characterId` (`USER` for the user's), `createdAt`, `context` (`main-chat` throughout), `isEdited`, `isRetrying`, `isCollapsed`, and `items`, references into the top-level `items` (each also names its `messageId`). An answer has `parentMessageId`, always a user message; a user message has no parent, so the thread is the user messages in `createdAt` order, each followed by its answers. One answer per message throughout; a user message may have none (one did). Several answers to one message by one model would be retries, which become versions here (the newest shown); by several models, one answer per lane. [INFERENCE: not in the sample.] There is no tree: the file holds no branches.
- **Edits.** `isEdited` is a flag on the message (one in the sample). The earlier text is not kept, so an edit becomes the edited text: nothing to make a version or branch from.
- **Items** are OpenAI Responses items. A user message: one `message` item, `content` a list of `input_text` parts. The parts after the first are pasted text files as fenced blocks (several of 4,000 to 27,000 characters); they stay text parts. An answer: `reasoning` items (`content` of `reasoning_text`) and `message` items (`content` of `output_text`, with `annotations` of `url_citation`: `url`, `title`, the quoted `content`), in the order of their `outputIndex` and `sequenceIndex`. An answer may hold two message items around a web search. `openrouter:web_search` items carry `action.query` and `action.sources` (`url`); `openrouter:web_fetch` items carry `url`, `title`, `httpStatus` and the page as a string `content`.
- **Mapping of parts.** `input_text` to text; `reasoning_text` to reasoning; `output_text` to text; `url_citation`, web search sources and web fetches to `source-url` parts, each URL once. Images and files would be `input_image` (`image_url`) and `input_file` (`filename`, `file_data`) in the Responses format, and tool calls `function_call` and `function_call_output` [INFERENCE: none in the sample]. The reader takes images and files as attachments, through the upload checks, and leaves out any other item type, counting it in the import's note.
- **Costs and tokens.** On each answer, `metadata.cost` (USD as a string) to `costUsd`; `metadata.variantSlug` to the answer's model; `tokensCount` is about 2.2 to 3 characters of answer and reasoning per token, so output tokens [INFERENCE], to `outputTokens`. No input tokens. `generationId`, `routerMetadata` (the provider chosen, the endpoints tried), `serverTools` and `plugins` are dropped.
- **Model ids.** `anthropic/claude-fable-5.1`, the one model in the sample, is offered by OpenRouter today. With OpenRouter active, a lane keeps an offered model id; one not offered, or any on a DeepSeek-only instance, becomes the default model, and the lane keeps the model's name from `modelInfo.short_name`, as the plan decided for chat files.
- **What is lost.** Artifacts (empty in the sample; their shape unknown), the router and plugin metadata, input tokens, earlier texts of edited messages, `isCollapsed`, and the per-model settings beyond `description` (none were set). Web fetches keep their URL and title, not the page.

Second sample (2026-11-25, `OpenRouter Chat Wed Nov 25 2026.json`, which you exported for this: one model answering a message with two images, then a second model added and both answering the next message, one stopped). It settles what the first sample left open:
- **Several models** are several `characters`; the second message has one answer from each, told apart by `characterId`. A model added after the first message is simply absent from it: lanes, as inferred. `samplingParameters` held `top_p` for one of them, a lane setting here.
- **Images** are `input_image` parts of the user's message item, `image_url` a `data:image/jpeg;base64,…` or `data:image/png;base64,…` URL (up to 1.2 MB of text), with `detail`. They become attachments, through the upload checks.
- **Tool calls** are not `function_call`, as inferred, but `openrouter:shell` items: `action.commands`, `arguments` (the call's JSON), `call_id`, `container_id`, `status`, and `output` (each with `stdout`, `stderr`, `outcome.exit_code`). They become code blocks in the answer's text (12.3: tool parts would make the next request fail), a call `in_progress` one marked as not finished.
- **Reasoning** can also be an item with only `encrypted_content` (a server tool round): unreadable, left out.
- **A stopped answer** has no `cost` and no `tokensCount` in its metadata, and ends with a call still `in_progress` and no message item. It imports as the stopped answer it was: its reasoning and the unfinished call, no text, no cost.

## 7. Ceilings and things left out

- Markdown is one-way.
- A chat file does not bring its libraries or Characters. A Character leaves as a card (milestone 9); libraries have no export yet.
- Import takes one chat at a time: the all-chats download is for keeping, and is not read back in one go.
- No scheduled or automatic backups.
- Imported costs are history only; budgets are not charged for them.
- People a chat is shared with cannot export it.
- An imported chat's user messages are all the importer's: the authors' names in the file are not kept as authors.
- Attachments no message names are stored with the chat but are linked to none.
