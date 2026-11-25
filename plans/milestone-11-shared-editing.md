# Milestone 11: edit access for people a chat is shared with

Status: 11.1 and 11.2 built (2026-11-25); 11.3 next. Part of `roadmap-milestones-7-14.md`. One migration (`0022_shared_editing`, both columns, written in 11.1). Needs 8.2 (the chat's tip).

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
| `message` | adds `userId` (FK `user`, set null): who sent a user message. The migration sets it to the chat's owner on existing messages. |

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

Built (11.1):
- Migration `0022_shared_editing` adds `chatShare.role` (`viewer` by default, so existing shares stay read-only) and `message.userId`, filled with the chat's owner on existing user messages. Both columns are written in 11.1, so the single migration of the plan holds. New user messages record their sender from now on (a sent message, "Save and resend", `/image`); 11.2 shows them.
- `chatAbilities` has `readChat`, `writeChat` and `manageChat`. Someone who may read the chat but not do the thing is told 403; someone who may not read it, 404. `findChat` returns `editors` beside `sharedWith`. `writeChat` covers the turn, speakers, `/compact`, `/image`, uploads, message edit and delete, votes and the tip; everything else stays `manageChat`, the conversation overview included.
- The turn and `/compact` pay as the sender: key, budget, rate limits and usage rows are the sender's, as they were. The chat's setup is the owner's: `chatOwner` gives `{{user}}` (the owner's name) and the libraries a Character brings (those the owner may read). Attachments must have been uploaded by the message's sender, no longer by the chat's owner.
- `PATCH /chats/:id` takes `sharedWith: [{ userId, role }]`; `GET /chats/:id` gives the reader's `role` (`owner`, `editor`, `viewer`, `null`) in place of `isOwner`, and versions and branches to editors too; `GET /me/shared-chats` gives the role.
- The share dialog has a role beside each person and for those being added, as the library's people dialog has. The chat page splits `isOwner` from `canWrite`: editors get the prompt (its "+" menu only with "Add files"; no web search or images switches, no memory slider, no Context popover), the actions on messages and answers, versions and branches, and the "/" commands but `rename`. "Shared with me" shows the role.
- Tests: the role table (owner, editor, viewer, stranger, admin, guest, link access, a banned owner) against read, write and manage with their statuses; attachments from whoever uploaded them, with an editor's own upload and the sender recorded; the migration's backfill.

Fixture check (DeepSeek faked; the admin as owner, three throwaway members):
- Every chat route as owner, editor, viewer, stranger and guest, with bodies that fail validation (400 means past the access check): reads 200/200/200/404/404; the turn, speakers, compact, images, message edit and delete, tip, votes and uploads pass for owner and editor, 403 for the viewer, 404 for the stranger, 403 for the guest; title and settings, lanes, libraries and the overview pass only for the owner, 403 for editor and viewer. An upload with a JSON body answers 500 for those allowed (the upload parsing, unchanged here).
- The owner's Character brought a private library with a note tagged "kestrel"; the editor, who gets 404 for that library, asked about the kestrel codename. The request held the note, and `{{user}}` was the owner's name. The usage rows were the editor's; the owner's spend did not move.
- In Chromium: the owner's share dialog showed mc-editor as "Editor: also takes part" and mc-viewer as "Viewer: reads". The editor had the prompt without the owner's switches, sent a message and got its answer. The viewer had no prompt and no actions; "Shared with me" showed "Viewer".
- The chat, library, Character, members and usage rows were deleted.

Built (11.2):
- The thread the chat page gets carries each user message's sender (`userId`) and `authors`, their names (else usernames) and avatars by id (`chatAuthors`), from every route that returns it: the chat, a deletion, a branch switch.
- `namedSenders` (`group.ts`) puts each user message of a lane's thread under its sender's name, as a group thread does, once that thread holds messages from more than one person; with one sender it is returned as it is, so nothing changes on the wire. `groupThread` takes the same `names`. The owner's name is `{{user}}` (the user's Character, else the owner's name); a sender whose account is gone is "Someone". The turn and `/compact` both use them.
- The chat page shows a chip (avatar and name) on each user message once the branch shown has more than one sender. A message just sent from the page counts as the reader's until the server's thread replaces it.
- Tests: both thread builders with one sender and with two (and a gone sender), and the group thread with and without names.

Fixture check (DeepSeek faked; the admin as owner, one throwaway editor):
- Separate lanes, the owner alone: the request held "First from the owner." as it was. After the editor wrote and the owner again: "Wilson: First from the owner.", "mc-editor: Second from the editor.", "Wilson: Third from the owner." The chat's `authors` named both, and its messages carried their senders.
- A group: "Wilson: Group hello from the owner." and "mc-editor: Group hello from the editor."
- In Chromium the owner saw the chips, Wilson with his avatar and mc-editor with the letter avatar; an older chat of the owner's alone showed none.
- The chats, the editor and the usage rows were deleted.

## 7. Ceilings and things left out

- No live typing, presence or streaming to the others; no notifications.
- An editor can edit and delete any message, the owner's included. It is a trust role.
- No per-person `{{user}}`, and editors do not bring their own Character.
- An editor cannot add models or libraries, and cannot share the chat on.
- With several server instances the 10 s refresh still works (it reads the database); nothing here needs a shared store.
