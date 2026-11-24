# Milestone 8: branching

Status: complete (2026-11-23), live run included. Part of `roadmap-milestones-7-14.md`. Two migrations (section 3).

Goal: nothing is thrown away when an answer is written again or a message is changed. Two things, with two names:

- **Versions** of an answer: the earlier answers stay, and you flip between them. The rest of the chat stays where it is. This is OpenRouter Chatroom's retry, which keeps nothing.
- **Branches** of the conversation: the chat continues another way from an edited message, and the earlier way stays reachable.

## 1. Decisions

| Topic | Decision |
|---|---|
| Regenerate | Adds a version of that answer. The newest is shown; `‹ 2/3 ›` on the answer flips. The version shown is the one the models read from then on. Later messages stay. |
| "Save and resend" | Starts a branch at that message with the new text, and the models answer it. The earlier branch (the old text and everything after it) is kept; `‹ 1/2 ›` on the message flips. It now also works on messages with attachments. |
| "Save" | Replaces a message's text in place, nothing else happens. A message's attachments, "@" references and mentions stay, so it now works on messages with attachments too. |
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
| migrations | 8.1 adds `active` and the index; answers are already one per message and lane, so all stay active. 8.2 adds `leafId`, sets every user message's and summary's `parentId` to the user message saved before it in its chat (today's chats are one branch), and every chat's `leafId` to its last user message. |

Deleting a message moves the messages after it up to its parent in the same transaction; the foreign key's `set null` is only a backstop (it would turn what followed into a branch at the start).

## 4. API

| Route | Change |
|---|---|
| `GET /chats/:id` | `messages` is the shown thread, in today's shape. Owner only: `versions`, for each shown answer with other versions the ids of all of them, oldest first (8.1); `branches`, for each shown user message with other branches the ids of all of them in the order made (8.3). |
| `POST /chats/:id` (the turn) | `submit-message`: the new message's parent is the chat's tip, and it becomes the tip. `regenerate-message`: saves a new active version. The thread is the path to the message being answered. |
| `PATCH /chats/:id/messages/:messageId` | `{ active: true }` shows a version. `{ text, branch: true }` replaces `dropAfter`: makes the sibling message, moves the tip to it, returns it. |
| `PUT /chats/:id/tip` | `{ messageId }`: shows the branch through that message. The server moves the tip to the end of it (at each step, the branch made last) and returns the shown thread (`messages`, `versions`, `branches`). A route of its own rather than a field of `PATCH /chats/:id`, which returns the chat's settings, not its thread. |
| `DELETE /chats/:id/messages/:messageId` | `?branch=true` removes the message with everything after it on that branch. Every deletion returns the shown thread. |

## 5. Frontend

- A small `‹ 2/3 ›` switch: on a user message that has branches, on an answer that has versions. Owner only; off while anything is being written.
- The answer's actions: "Regenerate" (tooltip "Regenerate: write this answer again from what came before it. The rest of the chat stays, and the earlier answer is kept as a version."). The edit form keeps "Save" and "Save and resend"; its hint says the earlier branch is kept.
- Switching replaces the list with what the server returns; the cached chat follows, as it does today.
- The delete button on a message opens a menu: "Delete this message" (with its answers; what follows stays) or "Delete this branch" (the message and everything after it), each confirmed.

## 6. Phases

| # | Work | Done when |
|---|---|---|
| 8.P | Spike I, below | the migration and the index hold on both databases |
| 8.1 | Versions: `active` and its index (the first migration), regenerate keeps the earlier answers, the version switch and its route, deleting a version, the stop preference | tests for saving, switching and deleting versions and for the cap; fixture: an answer regenerated twice has three versions; with version 1 showing, the next message's request holds version 1's text; a reload shows version 1 |
| 8.2 | The tree on the server: `leafId`, its migration (the backfill), `shownThread`, sending and joining by the tip, the turn's thread by path, `/compact`, speakers, overview, deleting with the move up, shared attachments. No change on screen. | tests for the thread picker (path, versions, summaries, a branch that leaves before a summary) and for deleting in the middle; every existing test passes; `scripts/app-smoke.ts` passes against a fixture platform |
| 8.3 | Branches on screen: "Save and resend" branches, the switch on messages, the route that shows a branch, "Delete this branch"; a smoke step; the live run | fixture: turn 2 of a four-turn chat is edited and resent; the chat shows two turns and the request holds turns 1 and the new 2 only; the switch brings the four turns back, and a new message there continues the old branch; a message with an image can be resent. Live on both platforms through `scripts/app-smoke.ts`: versions and a branch |

Built (8.1): migration `0018_answer_versions` adds `message.active` and the unique index `message_active_answer` (`parentId`, `chatModelId` where an active answer). In `server/utils/chat/turns.ts`, `saveAnswer` turns the lane's shown answer into an earlier version instead of deleting it; `listChatMessages` reads only shown versions, so the chat, every lane's thread, the group thread and `/compact` follow the version shown with no other change; `answerAttempt` takes the highest attempt over the versions (deleting the newest gives its attempt back, as deleting an answer did before); `showVersion` and `listAnswerVersions` are new; `deleteMessage` deletes one version and shows the lane's newest one left. Answers of a removed lane have no version switch: with the lane gone, which versions belong together is lost. `GET /chats/:id` gives the owner `versions` (shown answer id → every version's id, oldest first) rather than a `branching` object; 8.3 adds branches beside it. `PATCH …/messages/:id` takes `{ active: true }`; `DELETE` returns `shown`. On screen: `‹ 1/3 ›` before an answer's actions, off while anything is written; the chat page keeps `versions` beside its messages and adds a version when a regenerate finishes, or stops with "keep what was generated"; deleting a version says so and shows the next. Tests: versions kept, shown, followed by the lane's thread, deleted (shown and not), a user message going with all versions, and the cap over versions. Fixture check in Chromium (DeepSeek fixture): regenerated twice, "Version 3 of 3"; back to version 1, the next message's request held "assistant: Fixture answer 1."; after a reload, "Version 1 of 3" with answer 1; deleting version 1 showed answer 3 as "Version 2 of 2".

Built (8.2): migration `0019_conversation_tree` adds `chat.leafId` and the backfill of spike I. `server/utils/chat/thread.ts` holds `shownThread` (the branch to a tip, from `listChatMessages`' rows, which now cover every branch) and `threadTo` (the branch up to a message without what was added after it: its answers, a summary made after it). In `turns.ts`: `chatTip` (the chat's `leafId`, else its newest user message); a sent message follows the tip and becomes it, in one transaction that locks the chat row, so two sends cannot both follow the same tip; a lane joins a message only while it is the tip; a regenerate without a target answers the tip; "Save and resend" deletes what followed on that message's branches only and makes it the tip; deleting a user message moves what followed it, and the tip, up to its parent; a file another message of the chat still names stays and is linked to that message. A new chat's first message is its tip. The turn reads `threadTo` (a group speaker, `shownThread` to the message, which `groupThread` cuts at the round); `GET /chats/:id` returns the branch shown; `/compact` summarises it and its summaries hang on its tip; the speakers route takes the last round of the branch shown. The overview needed nothing: it reads the chat page's messages. Tests: the thread picker (path, a branch that leaves before a summary, a tip in the middle, a missing tip, a loop), sending and joining by the tip, deleting in the middle and the tip, "Save and resend" with another branch beside it, a shared attachment, and the 0019 backfill. Checked live instead of against a fixture: after 0019 ran on the dev database, the eight kept chats of spike I (the ninth is temporary) each showed all their messages with the tip on their last user message, and `scripts/app-smoke.ts` passed every step on both platforms ($0.001424 on OpenRouter, $0.001316 on DeepSeek).

Built (8.3): "Save and resend" is `branchMessage` (`PATCH …/messages/:id` with `{ text, branch: true }`, which replaces `dropAfter`): a new user message at the edited one's place, with the new text and the message's attachments, "@" references and mentions, as the tip; at most 50 branches at one place. `showBranch` and `PUT /chats/:id/tip` show a branch to its end (`branchEnd`, in `thread.ts`); `deleteMessage(…, branch)` and `?branch=true` delete a message with everything after it on its branches and, when the tip was there, show the branch made last at its place, else its parent. `chatThread` gives the thread as the chat page shows it (messages, `versions`, `branches` from `branchesOf`), for `GET /chats/:id`, the tip route and every deletion. "Save" now keeps a message's attachments, so the editor opens on any message with text. On screen: `ChatSwitch` (`app/components/chat/Switch.vue`) is the `‹ 1/2 ›` of both answers and messages; the edit form says "Save and resend" starts a new branch and keeps the earlier one; the delete button on a message is a menu with "Delete this message" and "Delete this branch". The chat page keeps `branches` beside `versions`, and a switch or a deletion replaces its thread with the server's. Tests: a branch with an attachment, the model's thread on it, switching back to the earlier branch's end and continuing it, deleting the branch shown (the tip moves to the other branch, the file stays), and a branch having rounds of its own. Fixture check in Chromium (DeepSeek fixture): turn 2 of a four-turn chat edited to "Turn 2, edited" and resent: two turns shown, "Branch 2 of 2", and the request held "Turn 1", answer 1 and "Turn 2, edited" only; "Earlier branch" brought back turns 1 to 4 with their answers, and "Turn 5" sent there followed turn 4 (its request held turns 1 to 5) and stayed after a reload; a message with an image, edited and resent, sent the new text with the image; "Delete this branch" on it showed the earlier image message again, and the image was still served. Live run (2026-11-23), `scripts/app-smoke.ts` with the new step "versions and a branch" (two versions, version 1 shown; "Save and resend" of the first message answered "ping"; back to the four messages of the earlier branch): every step passed on both platforms, $0.003044 on OpenRouter and $0.002344 on DeepSeek.

## 7. To verify before building

- **Spike I, the migration on real data.** On a copy of the dev database and on PGlite: the `parentId` backfill and the tip, the partial unique index on active answers, and `shownThread` returning every existing chat exactly as `listChatMessages` does today.

Result (2026-11-22, `model-chat-studio-prep/scripts/spikes/m8/`): the dev database had no chats, so `seed.ts` made nine through the app on DeepSeek, one of each shape it can produce: turn 1 regenerated after turn 3, a lane removed after answering, `/compact` followed by a turn and by a regenerate from before the summary, a message deleted in the middle, a group with round 1 regenerated after round 2, an image with "Save" and "Save and resend", two lanes answering at once, and a temporary chat. `migration.ts` ran the draft migration on them in one transaction and rolled it back: 406 ms for 46 messages, no duplicate answers or orphans, and for all 20 threads (9 whole chats, 11 lanes) the draft `shownThread` over the migrated rows gave exactly what `listChatMessages` gives today. On PGlite, after every migration of the app: `parentId` chained the user messages and the summary to the user message before them, the tip was the last user message (none in an empty chat), the index refused a second active answer of one lane to one message and took an inactive one, deleting the chat removed everything despite the two foreign keys between chat and message, and deleting the tip message set `leafId` to null.

The draft, kept for 8.1 and 8.2: the thread picker keeps the rows in `listChatMessages` order and filters them, so the order rule (an answer under its question, a summary at its place) is not repeated. A user message is shown when it is on the path from the tip up the `parentId` chain; an answer when its question is on the path and it is active; a summary when it has no parent or its parent is on the path.

Found: the migration goes in two. 8.1 needs only `active` and the index; the `parentId` backfill would be overwritten in its old meaning ("the newest message when sent", which can be an answer) by every message sent until 8.2 changes how messages are sent. So `active` and the index come with 8.1, `leafId` and the backfill with 8.2.

## 8. Ceilings and things left out

- The whole chat is loaded to pick the shown thread (as lane threads are loaded whole today).
- Readers cannot flip branches or versions.
- No "copy this chat from here into a new chat", and no merging of branches.
- The overview and the memory slider count the shown branch; the spend ledger counts everything ever generated.
