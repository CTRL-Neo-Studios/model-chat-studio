# Milestone 8: branching

Status: planned. Part of `roadmap-milestones-7-14.md`. One migration.

Goal: nothing is thrown away when an answer is written again or a message is changed. Two things, with two names:

- **Versions** of an answer: the earlier answers stay, and you flip between them. The rest of the chat stays where it is. This is OpenRouter Chatroom's retry, which keeps nothing.
- **Branches** of the conversation: the chat continues another way from an edited message, and the earlier way stays reachable.

## 1. Decisions

| Topic | Decision |
|---|---|
| Regenerate | Adds a version of that answer. The newest is shown; `‹ 2/3 ›` on the answer flips. The version shown is the one the models read from then on. Later messages stay. |
| "Save and resend" | Starts a branch at that message with the new text, and the models answer it. The earlier branch (the old text and everything after it) is kept; `‹ 1/2 ›` on the message flips. It now also works on messages with attachments. |
| "Save" | Unchanged: replaces a message's text in place, nothing else happens. |
| OpenRouter Chatroom's retry | Is what Regenerate already does, and keeps doing: the answer is written again from what came before it, and nothing after it changes or is sent (you, 2026-11-22). The difference here is only that the earlier answers stay as versions. No second button. |
| Wording | "Regenerate" stays, the name Chatroom users know; its tooltip says the rest of the chat stays. |
| Who sees what | Readers (shared, by link) see the branch and versions the owner has showing, without the switches. |
| A stopped regenerate | The member's preference applies as today: "keep the earlier answer" saves nothing; "keep what was generated" saves the partial answer as the new version. |
| Limits | `maxRegenerations` caps the versions of one answer, as it caps regenerating today. At most 50 branches at one message. |
| Deleting | A version: that version only; the newest one left is shown. A message: with its answers, and what followed moves up, as today. New: "Delete this branch" removes a message with everything after it on that branch. |
| `/compact` | Summarises the branch that is showing. A summary belongs to the message it was made after, so a branch that leaves the conversation earlier does not get it. |
| Group chats | Each branch has its own rounds; "whoever answered last round" follows the branch. |

## 2. What changes underneath

Today a chat is a flat list in the order saved. An answer replaces the lane's earlier one (`saveAnswer` deletes it), "Save and resend" deletes what follows (`editMessage` with `dropAfter`), and a user message's `parentId` ("the newest message when it was sent") is written but never read.

After:

- **User messages form a tree.** A user message's `parentId` is the user message before it on its branch; the first has none. Messages with the same parent are the branches at that point. Answers hang off their message as now. A summary's `parentId` is the message it was made after.
- **The chat knows its tip**: `chat.leafId`, the last user message of the branch that is showing. The thread shown is the path from the first message to the tip.
- **Answers have versions**: several answers of one lane to one message, one of them `active`.
- **One function picks the thread**: `shownThread(messages, leafId)` (pure, in `server/utils/chat/`), from the chat's messages, which are loaded whole as today. `GET /chats/:id`, a lane's thread, the group thread, `/compact`, the speakers route and the overview all go through it.
- **A turn does not depend on the tip.** The thread for answering a message is the path from the first message to that message, with the shown versions. So regenerating, or answering right after a switch, needs no extra state.
- **Attachments can be named by more than one message** (a branch made from a message with a file). A stored file goes when the last message of the chat that names it goes; today it goes with its one message.

## 3. Schema

| Table | Change |
|---|---|
| `chat` | adds `leafId` (FK `message`, set null): the tip of the shown branch. Null reads as the newest user message. |
| `message` | adds `active` (boolean, default true): on answers, the version shown. A partial unique index keeps one active answer per message and lane. `parentId` on user messages and summaries now means "the user message before it on its branch". |
| migration `0018` | sets every user message's and summary's `parentId` to the user message saved before it in its chat (today's chats are one branch), and every chat's `leafId` to its last user message. Answers are already one per message and lane, so all stay active. |

Deleting a message moves the messages after it up to its parent in the same transaction; the foreign key's `set null` is only a backstop (it would turn what followed into a branch at the start).

## 4. API

| Route | Change |
|---|---|
| `GET /chats/:id` | `messages` is the shown thread, in today's shape. New `branching`: for each shown user message with other branches, the ids of all of them in the order made; for each shown answer with other versions, the ids of all of them. Owner only. |
| `POST /chats/:id` (the turn) | `submit-message`: the new message's parent is the chat's tip, and it becomes the tip. `regenerate-message`: saves a new active version. The thread is the path to the message being answered. |
| `PATCH /chats/:id/messages/:messageId` | `{ active: true }` shows a version. `{ text, branch: true }` replaces `dropAfter`: makes the sibling message, moves the tip to it, returns it. |
| `PATCH /chats/:id` | `{ leafId }`: shows the branch through that message. The server moves the tip to the end of it (at each step, the branch made last) and returns the shown thread. |
| `DELETE /chats/:id/messages/:messageId` | `?branch=true` removes the message with everything after it on that branch. |

## 5. Frontend

- A small `‹ 2/3 ›` switch: on a user message that has branches, on an answer that has versions. Owner only; off while anything is being written.
- The answer's actions: "Regenerate" (tooltip "Write this answer again from what came before it. The rest of the chat stays."). The edit form keeps "Save" and "Save and resend"; its hint says the earlier branch is kept.
- Switching replaces the list with what the server returns; the cached chat follows, as it does today.
- The delete dialog on a message offers "This message and its answers" or "This branch".

## 6. Phases

| # | Work | Done when |
|---|---|---|
| 8.P | Spike I, below | the migration and the index hold on both databases |
| 8.1 | Versions: `active`, regenerate keeps the earlier answers, the version switch and its route, deleting a version, the stop preference | tests for saving, switching and deleting versions and for the cap; fixture: an answer regenerated twice has three versions; with version 1 showing, the next message's request holds version 1's text; a reload shows version 1 |
| 8.2 | The tree on the server: `leafId`, the migration, `shownThread`, sending and joining by the tip, the turn's thread by path, `/compact`, speakers, overview, deleting with the move up, shared attachments. No change on screen. | tests for the thread picker (path, versions, summaries, a branch that leaves before a summary) and for deleting in the middle; every existing test passes; `scripts/app-smoke.ts` passes against a fixture platform |
| 8.3 | Branches on screen: "Save and resend" branches, the switch on messages, the route that shows a branch, "Delete this branch"; a smoke step; the live run | fixture: turn 2 of a four-turn chat is edited and resent; the chat shows two turns and the request holds turns 1 and the new 2 only; the switch brings the four turns back, and a new message there continues the old branch; a message with an image can be resent. Live on both platforms through `scripts/app-smoke.ts`: versions and a branch |

## 7. To verify before building

- **Spike I, the migration on real data.** On a copy of the dev database and on PGlite: the `parentId` backfill and the tip, the partial unique index on active answers, and `shownThread` returning every existing chat exactly as `listChatMessages` does today.

## 8. Ceilings and things left out

- The whole chat is loaded to pick the shown thread (as lane threads are loaded whole today).
- Readers cannot flip branches or versions.
- No "copy this chat from here into a new chat", and no merging of branches.
- The overview and the memory slider count the shown branch; the spend ledger counts everything ever generated.
