# Milestone 9: Character cards

Status: spikes J and K done (2026-11-23); 9.1 next. Part of `roadmap-milestones-7-14.md`. One migration. Needs 8.1 (answer versions) for alternate greetings.

Goal: a Character becomes what a character card describes (a face, an opening line, example dialogue, a lorebook), and cards made elsewhere can be brought in and taken out.

## 1. Decisions

| Topic | Decision |
|---|---|
| Formats read | Character Card V2 (`chara_card_v2`) and V3 (`chara_card_v3`, read for what V2 has plus its nickname), and the older six-field V1. As `.json`, or as `.png` with the card in a text chunk (`ccv3` if present, else `chara`; base64 JSON). |
| Formats written | V2: `.json`, or `.png` (the avatar with the card inside) when the Character has an avatar. V2 is what every tool reads. |
| New on a Character | Avatar; greeting and alternate greetings; example dialogue; a closing note; creator's notes; tags. Its instructions stay the one text that takes the place of the system prompt. |
| Greeting | A chat started with a lane whose Character has a greeting opens with it, as that lane's first answer, with `{{char}}` and `{{user}}` filled. Alternate greetings are versions of it (milestone 8): flip with `‹ 1/3 ›`. A lane added to an existing chat does not greet. |
| Greeting in a group | Only the first lane that has one greets. |
| Example dialogue | Sent after the instructions, under "Example dialogue:", as written. |
| Closing note | The card's `post_history_instructions`: sent after the conversation on every turn, as a user message; the turn trace names it. |
| Lorebook | A card's `character_book` becomes a library, "<Name> lorebook", attached to the Character, with its lorebook switch on: one note per entry, the entry's keys as the note's tags. Auto-fetch then does what a lorebook does: a note is sent when one of its tags appears in the scanned messages (the user's and the answers'), to that Character's lane only (6.1). A lorebook is never offered to the file tools, and its notes are framed as what the Character knows (spike K). |
| What a lorebook loses | Secondary keys, insertion order and position, recursion, case sensitivity and the token budget have no counterpart; the chat's auto-fetch settings decide how much is sent. "Always on" entries go into the instructions under "Always:". The import says what it dropped. |
| Placeholders | `{{char}}` and `{{user}}` stay as written in everything stored and are filled at inference: instructions, greetings, examples, closing note, lorebook notes. V1 cards' `<USER>` and `<BOT>` become them on import. |
| Round trip | The card's other fields (creator, version, extensions, V3 extras) are kept as they came and written back on export. |
| Abilities | As for Characters today: your own, instance ones an admin publishes. |

## 2. From a card to a Character

| Card field | Here |
|---|---|
| `name` (V3 `nickname` kept beside it) | name |
| `system_prompt`, `description`, `personality`, `scenario` | instructions, in that order: the system prompt if any, the description, then "Personality: …" and "Scenario: …" |
| `first_mes`, `alternate_greetings` | greetings (the first is the one shown first) |
| `mes_example` | example dialogue |
| `post_history_instructions` | closing note |
| `creator_notes`, `tags` | shown on the Character's page; never sent to a model |
| `character_book` | a library, as above |
| the PNG itself | avatar |
| everything else | kept in `card`, untouched |

Export writes the instructions into `description` and leaves `system_prompt`, `personality` and `scenario` empty: once they are one text here, they are not split again. The tagged notes of the Character's own libraries become the lorebook.

## 3. Schema

| Table | Change |
|---|---|
| `character` | adds `avatarFileId` (FK `file`, set null), `greetings` (jsonb, list of texts), `examples` (text), `note` (text), `creatorNotes` (text), `tags` (jsonb), `card` (jsonb, the kept fields; null for Characters made here) |
| `character.instructions` | limit raised from 20,000 to 50,000 characters: cards are longer |
| `file` | an avatar is a `file` row without a chat, owned by whoever set it; it goes with the Character |
| `library` | adds `lorebook` (boolean, default false): its notes reach a lane only by keyword |

A greeting is an answer with no message before it (`parentId` null, the lane's `chatModelId`). Both platforms accept a thread that opens with an answer (milestone 3, spike D).

## 4. Behaviour

- **Starting a chat.** `POST /chats` writes each greeting version before the first user message, the first one active. The home page shows the first greeting above the prompt once such a lane is chosen.
- **Memory.** With a memory length set, a greeting falls out like any old message. With "all" it is always sent.
- **Avatars.** PNG, JPEG or WebP, at most 2 MB. Shown on the Characters page, on lane cards and answer headers, and in the models menu; the colour dot stays where there is none.
- **Import.** One file, at most 10 MB. The PNG's chunks are read in the app (no image decoding on the server), `ccv3` before `chara`, the format taken from the JSON's `spec`; the JSON is checked field by field; line ends become LF and `<USER>`/`<BOT>` become `{{user}}`/`{{char}}`; texts over their limits refuse the import and name the field; a lorebook may have at most 500 entries. Nothing a card names is fetched (V3 `assets` are ignored). The result is a Character of yours, a lorebook library of yours if the card has one (its switch on), and a list of what was dropped.

## 5. API

| Route | Purpose |
|---|---|
| `POST /characters`, `PATCH /characters/:id` | take the new fields |
| `PUT /characters/:id/avatar`, `DELETE …` | the avatar (form field `file`) |
| `GET /characters/:id/avatar` | the image, to signed-in members |
| `POST /characters/import` | a card file in, `{ character, libraryId?, dropped[] }` out |
| `GET /characters/:id/card?format=json\|png` | the card |
| `POST /chats` | writes greetings |

## 6. Frontend

- `/characters`: avatars on the cards; "Import card" (pick or drop a file) with the list of what was dropped; "Export card" in a Character's menu.
- The editor in tabs: Instructions; Greetings (a list, the first shown first); Examples and closing note; Lorebook (its libraries, with a link to each); About (creator's notes, tags, avatar).
- Avatars beside names wherever a lane is named.
- The home page's greeting preview.

## 7. Phases

| # | Work | Done when |
|---|---|---|
| 9.P | Spikes J and K, below | each is confirmed or the plan changes |
| 9.1 | The new fields, the avatar, example dialogue and closing note in the turn, the editor's tabs | tests for the context (examples after the instructions, the note after the conversation, placeholders filled); fixture: the request holds both in their places; an avatar shows on the lane card and the answer |
| 9.2 | Greetings: written at chat start, alternates as versions, the home page preview, the group rule | tests for what `POST /chats` writes; fixture: a chat with a greeting sends `assistant, user`; with the second greeting showing, the request holds the second; in a group only the first lane greets |
| 9.3 | Import: the PNG and JSON readers, the mapping, limits, the report | tests on card files of each version (V1, V2, V3; PNG and JSON; one over a limit, one that is not a card); in Chromium a V2 PNG becomes a Character with its avatar, greetings and examples |
| 9.4 | Lorebooks in (the library's lorebook switch: no file tools, answers scanned, notes framed as knowledge, placeholders filled), cards out, the live run | tests for entries to notes and back, and for what a lorebook sends and withholds; an exported card imports again to the same Character; live on both platforms: a lorebook entry keyed on a made-up place name reaches the answer only after the place is named (by the user or the answer), only in that Character's lane, without the model citing a note or calling a file tool |

## 8. To verify before building

- **Spike J, real cards.** Five cards from the wild through a throwaway chunk reader: V2 PNG, V3 PNG (both chunks present), V2 JSON, one with a large lorebook, one with Chinese text. What do their fields hold that the mapping above loses?
- **Spike K, a lorebook through auto-fetch.** With today's code: a Character with a library of tagged notes, in a chat on each platform. Does a note reach the model when its tag is said, with the chat's default auto-fetch settings (the last 5 user messages, 5 entries, 60,000 characters)? Is scanning only the user's messages enough, or do lorebooks need the answers scanned too (`scan`)?

Result J (2026-11-23, `model-chat-studio-prep/scripts/spikes/m9/cards.ts`): the real cards were yours, "Ignathius (UT)" as JSON and PNG, and SillyTavern's default "Seraphina" PNG (a 4-entry lorebook). A stress card made in the script covered Chinese text, CRLF and 600 entries with every entry option. What was found:
- **Both PNGs carry both chunks, `chara` and `ccv3`, with the same data.** Ignathius's `chara` chunk holds V3 JSON, Seraphina's V2. So the reader prefers `ccv3`, then `chara`, and goes by the JSON's `spec`, never by the chunk's name.
- **Ignathius, given as V2, is SillyTavern's V3 export.** It has `spec: chara_card_v3`, the V1 fields repeated at the top level, and `create_date`, `avatar`, `fav` and `talkativeness` beside them. Only the unmapped `data.*` fields are kept (creator, character_version, extensions, group_only_greetings, V3 extras). The top-level copies are written again from the Character on export.
- **Texts come with CRLF line ends:** normalised to LF.
- **`extensions` hold SillyTavern's own fields.** `world` names the linked world, here the same as the embedded book. `depth_prompt` is a note inserted N messages up, empty in both cards. `talkativeness` and `fav` are also there. All are kept for the round trip; a non-empty `depth_prompt` is listed as dropped.
- **Lorebook entries:** they have no `name`; SillyTavern puts the title in `comment`. The note's name is `comment`, else `name`, else the first key, made unique. Keys are common words ("wood", "forest", "magic") and phrases ("magical forest"); auto-fetch matches phrases as substrings. Their content is dialogue written with `{{user}}:` and `{{char}}:`.
- **Ignathius is a persona: written about `{{user}}`.** It works as "You are" with no special handling.
- **The PNG is the avatar.** Its card chunks (7 to 20 KB each) are stripped when it is stored, so a stale card does not ride along.
- **No real card with Chinese text or a large lorebook was at hand.** The stress card read correctly, and was refused for its 600 entries, as the limit says.

Result K (2026-11-23, `lorebook.ts`, live on both platforms):
- **Auto-fetch works as a lorebook:** a note arrives once its tag is said, and not before.
- **A place only the answer names is fetched only when answers are scanned too.** The default scans user messages only.
- **The file tools bypassed the lorebook.** A Character's library also gives its lane the file tools: on turn 1 both models listed and read every note on their own. Every answer also cited its source ("Thirteen, from the Vorthane note").
- **A note written with `{{char}}` and `{{user}}` reached the model unfilled.**

Decided after K (you, 2026-11-23):
- **Lorebook switch:** a library has a "lorebook" switch, set on import. A lorebook's notes arrive only by keyword, never through the file tools. Its keywords are matched in answers as well as user messages. Its notes are framed as what the Character knows, not as files to cite.
- **Placeholders:** `{{char}}` and `{{user}}` are stored as written and filled at inference, wherever they are sent: instructions, greetings, examples, closing note, lorebook notes.
- **V1 placeholders:** `<USER>` and `<BOT>` become `{{user}}` and `{{char}}` on import.

## 9. Ceilings and things left out

- A guest reading a link-shared chat sees colour dots, not avatars.
- No expressions or sprite sets, no per-Character voice (milestone 10 reads every answer in the member's voice), no V3 assets, no group-only greetings.
- A card's instructions are not split back into description, personality and scenario on export.
- Lorebook matching is auto-fetch's: whole words for plain Latin tags, no regular expressions, no secondary keys.
- Sharing a Character with a named person is still not possible: own, or instance.
