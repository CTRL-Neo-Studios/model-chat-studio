# Milestones 5–6: modular chats, characters, group chat

Status: milestone 5 built (5.1 to 5.4); spikes F and G done (section 5); 6.1 next. It replaces the "project" of milestone 4 (`plans/milestones-2-4-profiles-organisation-projects.md`, section 5) with parts that attach to a chat. The conventions of milestone 1 (section 2 there) apply unchanged.

Goal, in build order:

- **Milestone 5, attachments.** A chat is the fixed part. Context libraries (the project file space, freed from the project) and one context structure profile (today's "context profile") attach to any chat. A chat folder carries defaults for new chats. Projects go.
- **Milestone 6, characters and group chat.** A Character gives a lane its instructions and its own libraries. The user can have one too. In a group chat the lanes share one thread and answer in turn.

Libraries come first because characters attach them, and group chat needs characters to tell the speakers apart.

## 1. Decisions

| Topic | Decision |
|---|---|
| Names | "Context library" (`library`). "Context structure profile" (`structureProfile`), the block list that was "context profile". "Character" (`character`). "Model profile" stays. |
| Projects | Removed: pages, routes, `chat.projectId`, project folders, the `member` role, project-visible chats, the project badge. |
| Libraries per chat | Any chat, temporary ones too, attaches up to 5 libraries. Every lane reads them. |
| Library sharing | Per listed person: `viewer` (reads, attaches to their own chats), `editor` (also changes the files). Owner: people, rename, delete. |
| Structure profile | One per chat, on any chat. No library or folder owns one. |
| Folder defaults | A chat folder can name libraries and a structure profile. A new chat started in the folder gets a copy of them (from the nearest folder up the tree that has any). Changing the defaults later does not change existing chats. |
| Character | A name, instructions and optional libraries. Personal, plus instance ones an admin publishes (the model profile rules). |
| Character on a lane | A lane points at one Character, live: editing the Character changes every chat it is in. Its instructions replace the lane's system prompt while it is attached. A model profile can name a default Character for lanes started from it. |
| Character libraries | Read by that lane only, in every chat the Character joins. Libraries attach to chats and Characters, not to model profiles. |
| The user's Character | One per chat, from the same list, with a default in settings. Its name labels the user's messages; its text is sent with the instructions, or where a structure profile's block puts it. |
| Placeholders | `{{char}}` and `{{user}}` in Character instructions and in structure profile messages. |
| Chat mode | `separate` (today: each lane answers alone and never sees the others) or `group`. Chosen when the chat starts, offered once it has two lanes, fixed afterwards. |
| Group thread | One thread. A speaker sees the user's messages, its own answers as its own, and the others' answers as text labelled with their name. Reasoning and tool calls of others are not passed on. |
| Who answers a round | In this order: "@" mentions, in the order written. Else the decision model, when set, if it names anyone. Else the names found in the message text, in the order they appear. Else whoever answered the last round, in the same order. In a first round with nobody named, everyone in lane order. |
| Decision model | One of OpenRouter's Decisions models (System One models such as TypeSafe Jev, called through the Decisions API, which returns probabilities rather than text). An admin setting on the OpenRouter card, off while empty; `typesafe/jev-1.14` is the suggestion (spike G: right every time, under 0.2 s, $0.00004 a call). Used whenever an OpenRouter key is stored (the user's own, else the instance's), whichever platform is the main one. The only call that crosses platforms. Recorded like the title model. If it fails or takes more than 5 s, name matching decides. It says who the message asks to answer; it never applies "last round's speakers" itself. |
| Round order | Speakers answer one after another; each sees the answers before it in the round. Stop, or a failed answer, ends the round. Any lane can be asked to answer the last message afterwards. |
| Existing data | Kept: file spaces become libraries, attached to the chats that were in their project; a chat gets its project's default structure profile unless it had its own; `member` becomes `viewer`; pins follow. Project folders become ordinary folders. Rows are copied into the new tables in one migration, then the old ones dropped (spike H). |

## 2. What changes underneath

### 2.1 Attachments instead of ownership (milestone 5)

Today a chat reaches files through `chat.projectId`, and everything about files asks "which project". After: a turn asks "which libraries": the chat's (`chatLibrary`) plus, from milestone 6, the answering lane's Character's (`characterLibrary`), each only if the chat's author may read it.

Everything that reads files takes that list instead of one id:

| Reader | Change |
|---|---|
| "@" menu | Entries of every attached library, grouped by library. The stored reference is an entry id, so expanding it does not change. |
| Auto-fetch | Matches across the list. `settings.autoFetch.folders` are entry ids and stay as they are. |
| File tools | Paths start with the library's name when more than one is attached. `list_files` with no folder lists the libraries. |
| Structure profile `files` paths | Looked up in each library in attach order; `Library name/path` picks one. |
| `GET /files/:id` | Serves a library's file to its people, as now for a project's. |

### 2.2 One more thread shape (milestone 6)

`buildContext()` takes a thread and does not care where it came from. Today's lane thread is "every user message, plus this lane's answers". Group mode adds a second way to make one: every message up to the answer being written, with the other speakers' answers turned into labelled user-role text. The stages after that (structure profile, "@", auto-fetch, tools, trace) are untouched.

A round's order is stored on its user message (`metadata.speakers`, lane ids). It gives the display order, what a regenerated answer may see (the speakers before it), and "whoever answered last round".

The client already streams one request per answer into one list. In group mode it sends them one after another instead of together.

## 3. Milestone 5: attachments

### Schema

| Table | Change |
|---|---|
| `library` | was `project`; loses `contextProfileId` |
| `libraryMember` | was `projectMember`; `role`: `viewer`, `editor` (`member` becomes `viewer`) |
| `libraryEntry` | was `projectEntry`; `libraryId` |
| `chatLibrary` | new: PK (`chatId`, `libraryId`), both FK cascade; filled from `chat.projectId` |
| `structureProfile` | was `contextProfile` |
| `chat` | drops `projectId`, `projectVisible`; `contextProfileId` becomes `structureProfileId` |
| `chatFolder` | drops `projectId`; adds `defaults` jsonb: `libraryIds`, `structureProfileId`. Ids that no longer resolve are skipped |
| `pin` | kinds `project` and `contextProfile` become `library` and `structureProfile` |

### Access

| | Owner | Editor | Viewer |
|---|---|---|---|
| Read the files; attach the library to own chats, folders and Characters | yes | yes | yes |
| Add, edit, tag, move and delete files | yes | yes | no |
| People, rename, delete | yes | no | no |

- Someone who reads a chat by link or share sees the names of its libraries and of referenced files, and cannot open them unless the library is shared with them.
- When someone leaves or is removed, the library is detached from their chats, folder defaults and Characters.
- Deleting a library detaches it everywhere. The dialog names how many files go and how many of the owner's chats use it.

### API

| Route | Purpose |
|---|---|
| `/libraries`, `/libraries/:id`, `…/members`, `…/entries`, `…/files`, `…/files/from-chat` | today's `/projects` routes, renamed. `GET /libraries/:id/chats` and `?ownChats=` go |
| `/structure-profiles` | today's `/context-profiles`, renamed |
| `POST /chats` | accepts `libraryIds`, `structureProfileId`; with `folderId`, the folder's defaults fill what is not given |
| `PUT /chats/:id/libraries/:libraryId`, `DELETE …` | attach, detach |
| `PATCH /chats/:id` | `structureProfileId` on any chat; no `projectVisible` |
| `PATCH /folders/:id` | accepts `defaults` |
| `GET /chats/:id` | returns `libraries` (id, name, the reader's role or `null`) in place of `project` |

### Frontend

- `/libraries` (card grid, "Shared · Role", leave) and `/libraries/:id` (the Files tab and People dialog of today's project page). `/structure-profiles`. `/projects` goes.
- Every chat, and the home page before the first message, has a context popover (today's `ChatProjectSettings`): libraries, structure profile, auto-fetch, file tools. Attached libraries show as chips in the chat's header.
- `/shared` (5.4): the chats shared with the user by person, newest first, with their owner. A sidebar entry under Search.
- A folder's menu gets "Defaults…". "New chat" in a folder opens the home page with the defaults filled in and removable.
- "Add to project" becomes "Add to library", with a pick when the chat has several the user may edit.

### Phases

| # | Work | Done when |
|---|---|---|
| 5.1 | Rename to libraries and structure profiles; `chatLibrary`; the two-role access table; library pages; projects removed. A chat reads its files through its attachments | the chats that were in a project still get "@", auto-fetch and the file tools from the same files (fixture platform); both roles checked against the table with two accounts; no `project` left in routes, pages or schema |
| 5.2 | Several libraries on any chat; the context popover everywhere; structure profile on any chat; paths across libraries | the fixture receives a referenced note from each of two libraries, an auto-fetched file from the second, and a structure profile's `Library/path`; tests for path lookup with two libraries holding the same name |
| 5.3 | Folder defaults | a chat started in a subfolder carries its parent's libraries and profile; changing the defaults leaves that chat alone |
| 5.4 | "Shared with me": `GET /me/shared-chats`, the `/shared` page and its sidebar entry | with two accounts, a chat shared by person appears in the other's list and opens read-only; unsharing removes it; a public chat the user only opened by link does not appear |

Built (5.1): the turn, `/compact`, "@" and the context popover read the chat's first attached library only (marked `ponytail:`); 5.2 reads them all. There is no attach route or picker yet, so only migrated chats have a library until 5.2. `PATCH /chats/:id` already takes `structureProfileId` on any chat. The profile editor's "add from this project" path picker went with the project page; paths are typed. A library's chips in the chat header replace the project badge. Deleting a library takes no `ownChats` choice: chats stay, without it.

Built (5.2): paths and lookup live in `shared/utils/librarySpace.ts` (`spaceEntries`, `spaceResolver`), used by the server's readers and by the client's "@" menu and folder picker alike. `Library/path` is tried before the attach-order lookup, so a path the file tools hand out always finds its library. Attach order is `chatLibrary.createdAt`; `POST /chats` spaces its rows a millisecond apart. Detaching a library leaves its "@" references in old messages, which are then left out with a note. The popover's button reads "Context" without libraries, else "N libraries". The auto-fetch folder scope, when set, covers only the chosen folders, so libraries without a chosen folder are not fetched from.

Built (5.3): `chatFolder.defaults` (jsonb, `null`: none), migration `0015_folder_defaults`; `nearestDefaults` in `shared/utils/folderDefaults.ts` takes a folder's own defaults, else the nearest set above, as a whole (a folder's own replaces its parent's entirely). A folder's menu has "New chat here" (`/?folder=`) and "Defaults…". The home page fills the libraries and profile in and sends them as chosen, so a default removed there stays removed; `POST /chats` with `folderId` fills only what a request leaves out, skipping libraries and profiles the member can no longer use. Saving the dialog with nothing chosen removes the folder's own defaults, so a folder above applies again; there is no way to block a parent's defaults for one subfolder. Also fixed: the "@" and "/" menus were cut to a sliver by the editor's scroll box; they now hang off the page and open above the cursor.

Built (5.4): the route is `GET /me/shared-chats`, not `/chats/shared`: next to `/chats/:id` that path turned the typed response of every chat route into a union. It lists chats shared by name, not temporary ones, most recently active first, with the owner. The sidebar entry sits under Search. Someone who unshares makes the chat disappear from the list and return 404 at once; a chat only opened through a public link never appears.

## 4. Milestone 6: characters and group chat

### Schema

| Table | Change |
|---|---|
| `character` | new: `id`, `ownerId` (null: instance), `name`, `color`, `instructions` |
| `characterLibrary` | new: PK (`characterId`, `libraryId`) |
| `modelProfile` | adds `characterId` FK set null: the default for lanes started from it |
| `chatModel` | adds `characterId` FK set null |
| `chat` | adds `mode` (`separate`, `group`; default `separate`), `userCharacterId` FK set null |
| `message.metadata` | `speakers` on a user message in a group chat |
| settings | `inference.openrouter.decisionModel`; user preference `characterId` |
| `pin` | kind `character` |

Structure profile blocks, added:

| Kind | Content |
|---|---|
| `userCharacter` | where the user's Character text goes; at most one. Without it, after the instructions |
| `participants` | group chats: who else is in the chat, by name; at most one. Without it, after the instructions |

### Behaviour

- **Instructions.** A lane with a Character sends the Character's instructions where its system prompt would go. Removing the Character brings the lane's own prompt back.
- **Group context.** The instructions end with a short paragraph: who the speaker is, who else is present, and to answer only as itself. Messages of the user and of other speakers start with their name.
- **Regenerate.** Replaces one answer in place. It sees the round's earlier speakers, not the later ones. Later answers are not redone.
- **Mentions.** "@" in a group chat's prompt also lists the participants. Mentions travel as a part on the message, as file references do.
- **Name matching.** A participant's name (the Character's, else the lane's), whole word, case-insensitive, by first appearance. The whole-word rule is the auto-fetch matcher's.
- **Decision model.** One Decisions API call (spike G): the participants (with any other name a Character goes by), their usual order, last round's speakers and the message as `state`; a yes/no per participant on whether the message asks them to answer, and a choice per place. Those with a yes, ordered by the places; nobody asked goes on to the steps below. A refusal or a missing answer counts as not decided, as does a failure or more than 5 s. Its `usage.cost` is recorded as a usage event of a new kind, `decision`. Not called when the message has mentions.
- **`/compact` and memory.** In a group chat there is one summary for the shared thread, written by the first enabled lane's model, and the memory length counts the shared thread.
- **Limits.** `maxChatModels` still caps the enabled lanes. Each answer is billed and rate-limited on its own, so a round of three costs three answers, each reading the whole thread.
- **Layout.** A group chat is always stacked, in speaking order.

### API

| Route | Purpose |
|---|---|
| `GET /characters`, `POST …`, `PATCH /characters/:id`, `DELETE …` | own and instance Characters, with their libraries |
| `PATCH /chats/:id/models/:laneId`, `POST /chats/:id/models` | accept `characterId` |
| `POST /chats`, `PATCH /chats/:id` | `mode` on create only; `userCharacterId` |
| `POST /chats/:id/speakers` | `{ text, mentions }` to an ordered list of lane ids, by the rule above |
| `POST /chats/:id` (the turn) | in a group chat, builds the shared thread and records the lane in the round's `speakers` |

### Frontend

- `/characters`: card grid with Mine and Instance tabs; the form has the name, colour, instructions and libraries.
- A lane's settings and the model profile form get a Character select. A lane shows its Character's name.
- The home page offers "Separate answers" or "Group chat" once two lanes are chosen. The user's Character is picked in the context popover.
- A group round shows who answers, in order, as it runs. Each lane's header has "Answer" for the last message.
- `/admin/settings`: the decision model field on the OpenRouter card, a select of OpenRouter's Decisions models (`GET /models?output_modalities=decisions`, cached like the catalog), empty for off.

### Phases

| # | Work | Done when |
|---|---|---|
| 6.P | Spikes, section 5 | as below |
| 6.1 | Characters: table, routes, page, lane and model profile selects, the user's Character, placeholders, Character libraries | the fixture receives the Character's instructions for its lane and the other lane's own prompt; a file in a Character's library reaches only that lane; `{{char}}` and `{{user}}` are filled |
| 6.2 | Group mode: `chat.mode`, the shared thread, rounds one after another in lane order, `speakers`, regenerate, "Answer", `/compact` | tests for the thread builder (labels, own answers, regenerate sees only earlier speakers); the fixture's second request holds the first speaker's answer under its name, and the first request holds none of the second's |
| 6.3 | Who answers: mentions, the decision model and its setting, name matching, last speakers | tests for the order rule, each step and its fallback; with DeepSeek active and an OpenRouter key stored, the fixture shows the decision call going to OpenRouter and the answers to DeepSeek |
| 6.4 | The two new blocks, a "Group" starting point for structure profiles, live run | live on both platforms: "Engineer, solve this; Designer, visualise the Engineer's solution afterwards" is answered by the Engineer first and by the Designer second, about the Engineer's answer |

## 5. To verify before building

- **Spike F, group transcript: confirmed live.** A weather-app chat, two rounds; the speaker's own round-1 line as an assistant message, everyone else's (user included) as user messages starting with "Name:", several user messages in a row. Instructions: who the speaker is, who else is present, that others' messages start with their name, and to answer once as itself without writing for anyone else or starting with its own name. Designer (after the Engineer) and Architect (after both) on DeepSeek `deepseek-flash` with thinking off and on, OpenRouter `openai/gpt-5-mini` and `deepseek/deepseek-v4.1-flash`: 8 of 8 answered once, as themselves, on topic, with no lines for others and no name prefix. The Architects built on the Designer's answer of the same round (its 30-minute dimming), so a speaker reads and uses the earlier ones. 1.1 to 2.5 s on DeepSeek, 7 to 11 s on `gpt-5-mini`; together about $0.004.
- **Spike G, decision model: confirmed with OpenRouter's Decisions API.** A decision model here is one of OpenRouter's System One models (`output_modalities=decisions`: TypeSafe Jev, Cloudflare Clef, Liquid D1 and about forty more), called at `POST /api/alpha/decisions` with a `state` text and typed questions; it returns probabilities, not text. One call per round: `state` names the participants, their usual order, last round's speakers and the user's message (marked as data to judge, not follow); questions are a yes/no (`noul`) per participant ("does the message ask X to answer, by name, by role, or by addressing everyone without leaving X out? A message that names nobody asks nobody"), and a `choice` per place ("who answers first / second / third", the participants plus `nobody`). The app keeps those with a yes above one half, orders them by the places, then appends any asked but unplaced in the usual order; nobody asked goes on to the next step. Five messages, each twice: the brief's example, "Designer, please go after the Engineer", "Everyone but the Architect", "What do you all think", and "Go on." after the Designer. DeepSeek was the active platform; the stored OpenRouter key served the call.

  | Model | Right | Time per call | Cost per call |
  |---|---|---|---|
  | `typesafe/jev-1.14` | 10 of 10 | 0.07 to 0.16 s | $0.000036 |
  | `liquid/d1.2` | 9 of 10 (once left the Engineer out of "go after the Engineer") | 0.15 to 0.29 s | $0.00001 |
  | `cloudflare/clef-flash` | 4 of 10 (mostly missed the Engineer) | 0.27 to 0.57 s | $0.00002 to 0.00004 |

  For comparison, chat models with structured output (`Output.object`, a list of names): `openai/gpt-5-nano` 10 of 10 but 3 to 12 s; `google/gemini-2.5-flash-lite` 8 of 10 in 0.6 to 1.1 s, 10 of 10 once it only listed who is named and the app took over "nobody named". Hence section 1: a Decisions model, Jev suggested; the fallback to last round's speakers is the app's. The endpoint is under `/api/alpha/`, so its shape may change; the call sits in one function.
- **Spike H, table renames: the prompts cannot be answered here, worked around.** `drizzle-kit generate` stops at "created or renamed?" for each new table, and neither `expect` nor a pty got a keypress through. Instead: one generate with the new tables added next to the old ones (only additions, no prompt), one with the old ones removed (only drops, no prompt); the two files merged into `0014_libraries.sql` with the data copies between them, and the second snapshot kept. Rows are copied, not renamed, so constraint and index names are drizzle's own. The generated drops had to be reordered: dropping a table with `CASCADE` already took the foreign keys the next statements dropped. `test/migrations.test.ts` checks the data moves; the dev database applied it.

## 6. Ceilings and things left out

- People who share a library no longer see each other's chats in one place. Chats are shared one by one; "Shared with me" (5.4) lists those.
- A folder's defaults are libraries and a structure profile. Not the lanes, the mode or the user's Character.
- Name matching reads names, not meaning: "the Engineer goes after the Designer" puts the Engineer first. The decision model is what fixes that.
- The decision model runs through OpenRouter only.
- A Character has no avatar, greeting or example dialogue, and SillyTavern cards are not imported.
- A group chat cannot become a separate-answers chat, or the other way round.
- A speaker sees the others' text only: not their reasoning, charts or files.
- At most 5 libraries per chat and 5 per Character.
