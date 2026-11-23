# Milestone 11: edit access for people a chat is shared with

Status: planned. Part of `roadmap-milestones-7-12.md`. Migration `0020`. Needs 8.2 (the chat's tip).

Goal: someone a chat is shared with can take part in it, not only read it.

## 1. Decisions

| Topic | Decision |
|---|---|
| Roles | Each listed person is a `viewer` (today's read-only share) or an `editor`. Link access stays read-only. |
| An editor may | Send messages and attach files; ask for another version or retry; stop; edit and delete messages; vote; flip branches and versions; run `/compact`. |
| Only the owner may | Rename, share, change link access, delete the chat; change its models, libraries, structure profile, Characters and settings; move it; keep a temporary chat. |
| Who pays | The sender: their own key for the active platform, else the instance key against their own budget. Usage rows carry the sender and the chat. Rate limits are the sender's. The same for the decision model, speech and images. |
| Whose setup | The chat's, as the owner made it: its models, prompts, Characters and libraries. Libraries are read with the owner's access, as today, so an editor's turn may draw on a library the editor cannot open. That comes with being let into the chat, as it already does for what viewers read in the answers. |
| Who wrote what | Each user message records its author. With more than one author in a chat, messages show the author's name and avatar, and the models get each message under its author's name. |
| `{{user}}` and the user's Character | The owner's. They describe the chat's main person, and the instructions are the owner's. |
| Keeping in step | No live connection. While a chat with editors is open and nothing is being written there, the page asks for new messages every 10 s and when the window gets focus. An answer appears for the others once it is saved, not while it streams. |
| Two people sending at once | A message names the tip it was written after. If the chat has moved on, the server refuses it (409); the page loads what is new and leaves the text in the prompt to send again. Without this the second message would quietly become a branch. |
| Branch and version switches | Shared: there is one shown branch for everyone. |
| Leaving | An editor or viewer can leave a chat shared with them. |
| Temporary chats | Cannot be shared, as today. |

## 2. What changes underneath

- **A third ability.** `readChat` (as today), `writeChat` (owner and editors: the turn, speakers, `/compact`, message edit and delete, uploads, votes, switches) and `manageChat` (owner). Each route moves to the one it needs.
- **The turn takes the sender for money and the owner for access.** `useInference`, the budget, rate limits and usage use the sender; `laneLibraries` and Character checks use the chat's owner.
- **Authors.** `message.userId`. A lane's thread and the group thread name a message's author when the chat has more than one; otherwise nothing changes on the wire.
- **The page's message list can take in what the server has.** Today it starts from the cached chat and only it writes. It gains one merge: when idle and the server's shown thread differs, the server's wins.

## 3. Schema

| Table | Change |
|---|---|
| `chatShare` | adds `role` (`viewer`, `editor`; default `viewer`) |
| `message` | adds `userId` (FK `user`, set null): who sent a user message. Migration `0020` sets it to the chat's owner on existing messages. |

## 4. API

| Route | Change |
|---|---|
| `PATCH /chats/:id` | `sharedWith` takes `{ userId, role }` |
| `DELETE /chats/:id/shares/me` | leave |
| `GET /chats/:id` | adds the reader's `role` (`owner`, `editor`, `viewer`, or none for a guest) and each user message's author (name, avatar) |
| `POST /chats/:id` (the turn) | `writeChat`; a new message carries `after`, the tip it follows; 409 when the tip has moved |
| `GET /me/shared-chats` | adds the role |
| message, file, vote, speakers, compact, switch routes | `writeChat` |

## 5. Frontend

- The share dialog: a role beside each person, as the library's people dialog has.
- The chat page separates "may write" from "is the owner": editors get the prompt and the answers' and messages' actions; the models menu, the context popover's attachments and the title menu stay the owner's.
- Author chips on messages when there is more than one author.
- Taking in new messages while idle; the "chat moved on" notice.
- "Shared with me": the role, and "Leave".

## 6. Phases

| # | Work | Done when |
|---|---|---|
| 11.1 | Roles, the three abilities, the share dialog, an editor's turn billed to the editor | tests for every route against owner, editor, viewer, guest and stranger; a test that an editor's turn records usage under the editor and reads the owner's libraries; in Chromium with two accounts against a fixture: an editor sends and gets an answer, a viewer has no prompt, the owner's budget is untouched |
| 11.2 | Authors: the column, names in the threads, chips | tests for both thread builders with one and two authors; fixture: the request holds the editor's message under the editor's name and the owner's under the owner's |
| 11.3 | Keeping in step: the tip check, taking in new messages, leaving; a smoke step | fixture with two accounts: the owner's open page shows the editor's message and answer within 10 s without a reload; two messages sent at once give one 409, and the second sender's text is still in the prompt; an editor who left gets 404 |

## 7. Ceilings and things left out

- No live typing, presence or streaming to the others; no notifications.
- An editor can edit and delete any message, the owner's included. It is a trust role.
- No per-person `{{user}}`, and editors do not bring their own Character.
- An editor cannot add models or libraries, and cannot share the chat on.
- With several server instances the 10 s refresh still works (it reads the database); nothing here needs a shared store.
