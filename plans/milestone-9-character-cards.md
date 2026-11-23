# Milestone 9: Character cards

Status: spikes J and K, 9.1 and 9.2 built (2026-11-23); 9.3 next. Part of `roadmap-milestones-7-14.md`. Two migrations: the Character's fields (9.1), the library's lorebook columns (9.4). Needs 8.1 (answer versions) for alternate greetings.

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
| Lorebook | A card's `character_book` becomes a library, "<Name> lorebook", attached to the Character, with its lorebook switch on: one note per entry, the entry's keys as the note's tags, its other options kept with the note (section 2b). A note is sent when its keys appear in the scanned messages (the user's and the answers'), to that Character's lane only (6.1). A lorebook is never offered to the file tools, and its notes are framed as what the Character knows (spike K). |
| Lorebook options | None is dropped: they are kept, shown under "Advanced", and honoured, or converted on import to what the app already has (section 2b). |
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
| `character_book` | a lorebook library: notes, and their options (section 2b) |
| the PNG itself | avatar |
| everything else | kept in `card`, untouched |

Export writes the instructions into `description` and leaves `system_prompt`, `personality` and `scenario` empty: once they are one text here, they are not split again. The tagged notes of the Character's own libraries become the lorebook.

## 2b. Lorebook options

Every option of a card's book and entries (V2's, and SillyTavern's in `extensions`) is kept: on the library (`lorebook`) and on each note (`lore`). They show under "Advanced" and are honoured as below. Where the app already has the thing, import converts the option to it.

| Option | Here |
|---|---|
| `keys` | the note's tags: matched case-insensitively, whole words for plain Latin, as auto-fetch does |
| `content`, `comment` / `name` | the note's text and name |
| `enabled` | honoured: off is never sent |
| `constant` | honoured: always sent, ahead of keyword matches (no longer copied into the instructions) |
| `secondary_keys`, `selective`, `selectiveLogic` | honoured: "also needs" keys with AND ANY, AND ALL, NOT ANY or NOT ALL |
| `case_sensitive`, `match_whole_words` | honoured, per entry; unset follows the default above |
| `scan_depth` (book and entry) | honoured: how many recent messages are searched; the book's replaces the chat's auto-fetch `scanMessages` for this library |
| what is scanned | a lorebook scans the user's messages and the answers (spike K). SillyTavern's "match also in" options (character description, personality, scenario, persona) convert to scanning the Character's instructions, or the user's Character |
| `insertion_order`, `priority` | honoured: the order notes are sent in, and the budget drops the lowest first |
| `token_budget` (book) | converted to a character budget (4 characters a token), replacing the chat's `maxChars` for this library; entries over it are left out, lowest order first |
| `position`, `depth`, `role` | honoured, as three places: with the instructions (`before_char` before them, `after_char` and SillyTavern's "before/after examples" after them), at a depth N messages up as `role` (SillyTavern's "@ depth"; its author's-note positions convert to depth 4 as system, where SillyTavern puts the note by default), or unset, where auto-fetch's message goes (the structure profile's place) |
| `recursive_scanning` (book), `prevent_recursion`, `exclude_recursion`, `delay_until_recursion` | honoured: sent notes are searched for more keys, at most 3 passes |
| `group`, `group_override`, `group_weight`, `use_group_scoring` | honoured: one entry per group is sent, by override, then score, then weight |
| `probability`, `useProbability` | honoured: the chance an entry is sent when it matches |
| `sticky`, `cooldown`, `delay` | honoured, from the lane's turn traces, which record what each answer was sent: stays N messages after it fired, waits N after it ends, not before the chat has N messages |
| `vectorized` | converted to full-text matching of that entry (auto-fetch's "fuzzy" search, per entry) |
| `automation_id`, an outlet position, anything unknown | kept for export, shown as not used here |
| the book's `name`, `description` | the library's name and description |

## 3. Schema

| Table | Change |
|---|---|
| `character` | adds `avatarFileId` (FK `file`, set null), `greetings` (jsonb, list of texts), `examples` (text), `note` (text), `creatorNotes` (text), `tags` (jsonb), `card` (jsonb, the kept fields; null for Characters made here) |
| `character.instructions` | limit raised from 20,000 to 50,000 characters: cards are longer |
| `file` | an avatar is a `file` row without a chat, owned by whoever set it; it goes with the Character |
| `library` | adds `lorebook` (jsonb, null for an ordinary library): the switch, and the book's options (section 2b) |
| `libraryEntry` | adds `lore` (jsonb, null): a note's lorebook options (section 2b); kept when the switch is turned off |

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
- A library's settings: the lorebook switch, and under "Advanced" the book's options. A note in a lorebook: its keywords as today, and under "Advanced" (closed by default) the entry's options of section 2b, with what each does in one line.
- Avatars beside names wherever a lane is named.
- The home page's greeting preview.

## 7. Phases

| # | Work | Done when |
|---|---|---|
| 9.P | Spikes J and K, below | each is confirmed or the plan changes |
| 9.1 | The new fields, the avatar, example dialogue and closing note in the turn, the editor's tabs | tests for the context (examples after the instructions, the note after the conversation, placeholders filled); fixture: the request holds both in their places; an avatar shows on the lane card and the answer |
| 9.2 | Greetings: written at chat start, alternates as versions, the home page preview, the group rule | tests for what `POST /chats` writes; fixture: a chat with a greeting sends `assistant, user`; with the second greeting showing, the request holds the second; in a group only the first lane greets |
| 9.3 | Import: the PNG and JSON readers, the mapping, limits, the report | tests on card files of each version (V1, V2, V3; PNG and JSON; one over a limit, one that is not a card); in Chromium a V2 PNG becomes a Character with its avatar, greetings and examples |
| 9.4 | Lorebooks: the switch and the book's settings, the entry options of section 2b in the matcher (keys and secondary keys, recursion, groups, timed effects, chance, budget, order and placement), the note editor's "Advanced" section, entries in on import with what was converted | tests for the matcher, one per option and their interplay (a group under the budget, recursion into a delayed entry, sticky after cooldown); tests for entries to notes and back; fixture: a lorebook note arrives by keyword, is not offered to the file tools, has its placeholders filled, sits where its position says |
| 9.5 | Cards out, the live run | an exported card imports again to the same Character, lorebook options included; live on both platforms: a lorebook entry keyed on a made-up place name reaches the answer only after the place is named (by the user or the answer), only in that Character's lane, without the model citing a note or calling a file tool |

Built (9.1): migration `0020_character_cards` adds `avatarFileId`, `greetings`, `examples`, `note`, `creatorNotes`, `tags` and `card` to `character`; `characterFieldsSchema` takes them (texts up to 50,000 characters, at most 50 greetings and 50 tags). The library columns of section 3 come with 9.4, in a migration of their own. `laneIdentity` fills the examples and the closing note as it fills the instructions; `buildContext` puts the examples after the lane's instructions under "Example dialogue:" (the trace's instructions label says "+ example dialogue"), and the closing note after the conversation as a user message, a `note` block in the trace (counted with the instructions in the overview's bar), with auto-fetched files before it unless the profile places them. Avatars: `PUT`, `DELETE` and `GET /characters/:id/avatar`; the type is read from the image's first bytes (PNG, JPEG, WebP), at most 2 MB; the file row has no chat; the URL carries the file's id, so it is cached for good and changes when the image does; deleting the Character or replacing the avatar deletes the file. `LaneDot` shows the avatar, else the colour dot: on the Characters page, in the models menu (button and lanes), in an answer's header, and a single model's answer gets a header when its Character has an avatar. The editor has the tabs of section 6; the avatar is sent after the Character is saved. "Copy to my Characters" copies the texts, not the avatar. Tests: the context (examples after the instructions, the note after the conversation and before auto-fetch, a profile's auto-fetch place kept) and the identity (examples and note filled, empty ones left out). Fixture check in Chromium (DeepSeek fixture): a Character "Wren" made in the editor's tabs with instructions, example dialogue, a closing note, a tag and your card's PNG as avatar; in a chat with Wren and a plain lane, Wren's request was `system: You are Wren, a travel guide talking with Wilson. / Example dialogue: Wilson: Where to? Wren: North, past the salt flats.`, `user: Which way to the coast?`, `user: Stay in character as Wren; Wilson is the traveller.`, and the plain lane's had neither; the avatar showed on the Characters page, on Wren's card header and in the models menu; after deleting Wren its avatar answered 404.

Built (9.2): `greetingMessages` (`server/utils/chat/greetings.ts`) gives the answers a new chat opens with: each enabled lane whose Character has greetings, all of them as versions of one answer, the first shown, `{{char}}` and `{{user}}` filled, metadata `greeting: true`; in a group only the first lane that has one. `POST /chats` writes them after the lanes and before the first message, so they come first in order. A greeting answers no message (`parentId` null): `shownThread` keeps it on every branch, `threadTo` keeps it for the first answer, `groupThread` opens the shared thread with it (the greeter's own as its answer, the others' under its name), and a separate lane's thread holds only its own lane's. Versions of a greeting switch and delete like an answer's (`sameParent` in `turns.ts` covers a missing parent); a greeting is not regenerated (the turn refuses it, the button is hidden) but can be edited. The chat page shows greetings as the first group of answers, footed "Greeting", and still asks every model to answer the first message when the chat was just made. The home page shows each answering Character's first greeting above the prompt (in a group only the first one's), filled, with how many more there are. Tests: what `greetingMessages` writes (order, filling, a disabled lane, a lane without greetings, the group rule), greetings in the thread picker and the group thread, and greeting versions in the database (shown first, read by their lane only, switched, deleted, not regenerated). Fixture check in Chromium (DeepSeek fixture): "Wren" with two greetings, started from a profile on the home page, showed "Wren opens the chat; 1 more greeting to flip to" with the first greeting filled ("You made it, Wilson."); the first request was `assistant: *Wren looks up from the map.* You made it, Wilson.`, `user: Which way to the coast?`; after switching to version 2, the next request opened with `assistant: Back again, Wilson? The coast road is open.`, and a reload kept "Version 2 of 2"; in a group of Wren and Bard (both with greetings) only Wren greeted, Wren's request opened with its greeting as its own answer and Bard's with `user: Wren: *Wren looks up from the map.*…`.

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
- **Lorebook options (you, 2026-11-23):** none is dropped. Each entry's and book's options are kept, behind an "Advanced" section, and honoured where the app can do what they do; where something here already does it, the option is converted to that on import (section 2b).

## 9. Ceilings and things left out

- A guest reading a link-shared chat sees colour dots, not avatars.
- No expressions or sprite sets, no per-Character voice (milestone 10 reads every answer in the member's voice), no V3 assets, no group-only greetings.
- A card's instructions are not split back into description, personality and scenario on export.
- Regular-expression keys (`/…/`) are kept and shown, and matched as plain text: a pattern from a card is not run on the server.
- Lorebook entries placed in SillyTavern's author's note or an outlet go where section 2b says, not there: there is no author's note or outlet here.
- Sharing a Character with a named person is still not possible: own, or instance.
