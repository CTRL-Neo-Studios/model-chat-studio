# Milestone 12: export and import of chats

Status: planned. Part of `roadmap-milestones-7-14.md`. No migration. Comes after milestones 8 to 11, so the file covers branches, versions, images and authors.

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

## 6. To verify before building

- **Spike N, the OpenRouter export.** From the sample you provide: which fields it has; how several models' answers to one message are stored and whether they map onto lanes; whether a retry or an edit leaves earlier versions in the file, and if so whether they map onto versions and branches; how attachments, reasoning and costs appear; which of its model ids exist here when OpenRouter is the active platform, and what a DeepSeek-only instance should do with them.

## 7. Ceilings and things left out

- Markdown is one-way.
- A chat file does not bring its libraries or Characters. A Character leaves as a card (milestone 9); libraries have no export yet.
- Import takes one chat at a time: the all-chats download is for keeping, and is not read back in one go.
- No scheduled or automatic backups.
- Imported costs are history only; budgets are not charged for them.
- People a chat is shared with cannot export it.
