# Milestone 9: Character cards

Status: planned. Part of `roadmap-milestones-7-14.md`. One migration. Needs 8.1 (answer versions) for alternate greetings.

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
| Lorebook | A card's `character_book` becomes a library, "<Name> lorebook", attached to the Character: one note per entry, the entry's keys as the note's tags. Auto-fetch then does what a lorebook does: a note is sent when one of its tags appears in the scanned messages, to that Character's lane only (6.1). |
| What a lorebook loses | Secondary keys, insertion order and position, recursion, case sensitivity and the token budget have no counterpart; the chat's auto-fetch settings decide how much is scanned and sent. "Always on" entries go into the instructions under "Always:". The import says what it dropped. |
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

A greeting is an answer with no message before it (`parentId` null, the lane's `chatModelId`). Both platforms accept a thread that opens with an answer (milestone 3, spike D).

## 4. Behaviour

- **Starting a chat.** `POST /chats` writes each greeting version before the first user message, the first one active. The home page shows the first greeting above the prompt once such a lane is chosen.
- **Memory.** With a memory length set, a greeting falls out like any old message. With "all" it is always sent.
- **Avatars.** PNG, JPEG or WebP, at most 2 MB. Shown on the Characters page, on lane cards and answer headers, and in the models menu; the colour dot stays where there is none.
- **Import.** One file, at most 10 MB. The PNG's chunks are read in the app (no image decoding on the server); the JSON is checked field by field; texts over their limits refuse the import and name the field; a lorebook may have at most 500 entries. Nothing a card names is fetched (V3 `assets` are ignored). The result is a Character of yours, a lorebook library of yours if the card has one, and a list of what was dropped.

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
| 9.4 | Lorebooks in, cards out, the live run | tests for entries to notes and back; an exported card imports again to the same Character; live on both platforms: a lorebook entry keyed on a made-up place name reaches the answer only after the user names the place, and only in that Character's lane |

## 8. To verify before building

- **Spike J, real cards.** Five cards from the wild through a throwaway chunk reader: V2 PNG, V3 PNG (both chunks present), V2 JSON, one with a large lorebook, one with Chinese text. What do their fields hold that the mapping above loses?
- **Spike K, a lorebook through auto-fetch.** With today's code: a Character with a library of tagged notes, in a chat on each platform. Does a note reach the model when its tag is said, with the chat's default auto-fetch settings (the last 5 user messages, 5 entries, 60,000 characters)? Is scanning only the user's messages enough, or do lorebooks need the answers scanned too (`scan`)?

## 9. Ceilings and things left out

- A guest reading a link-shared chat sees colour dots, not avatars.
- No expressions or sprite sets, no per-Character voice (milestone 10 reads every answer in the member's voice), no V3 assets, no group-only greetings.
- A card's instructions are not split back into description, personality and scenario on export.
- Lorebook matching is auto-fetch's: whole words for plain Latin tags, no regular expressions, no secondary keys.
- Sharing a Character with a named person is still not possible: own, or instance.
