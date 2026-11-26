# Milestone 13: Explore, a place to publish and get content

Status: spike O and 13.1 built (2026-11-26); 13.2 next. Part of `roadmap-milestones-7-14.md`. One migration. Needs 7.1 (folder defaults, built) and milestone 9 (so a published Character carries its avatar, greetings and lorebook). It does not need 10 to 12 and can be built right after 9.

Goal: members publish what they have made (Characters, libraries, structure profiles, and whole setups such as a "Full-stack Dev Team") to a page everyone on the instance can browse, and get what others published. No money changes hands. Inspired by nuxt.com/modules: a searchable grid of cards with a kind, tags and counts, and a page per entry. Stars, star lists, review before publishing and reports are milestone 14.

## 1. Decisions

| Topic | Decision |
|---|---|
| Name | The page is "Explore". What is published there is a "listing". |
| Who | Every signed-in member browses and gets. Publishing: every member, unless an admin or moderator turns it off. Guests see nothing of it. One instance: nothing is exchanged with other instances. |
| Kinds | Character (with its libraries, so its lorebook comes along), library, structure profile, and pack. |
| Pack | Several of those together, optionally with a chat setup: the models and who each is, group or separate answers, the structure profile, the libraries, the chat settings. A setup has the shape of a folder's defaults (7.1), and a pack is published from a folder: "Full-stack Dev Team" is a folder whose defaults are an Engineer, a Designer and a group chat. |
| Model profiles | Not listed on their own. A pack's models carry their settings as lane fields; a model this instance does not offer falls back to the default model, as it does today. |
| Publishing is a snapshot | A listing holds a copy of the content as it was when published. Changing or deleting your own Character afterwards changes nothing on Explore. "Publish an update" takes a new snapshot as the next version, with a note on what changed. |
| What can be published | Only what is yours: your own Characters, libraries and structure profiles. A library someone shared with you cannot be republished; a Character that uses one is published without it, and the dialog says so. |
| Getting is a copy | "Get" makes your own copies: a Character with its libraries, a library, a structure profile. A pack makes all of its items and, when it has a setup, a folder named after it whose defaults are that setup, so "New chat here" starts it. Copies are yours to change. |
| Updates | A listing you got shows when a newer version exists. "Get the new version" makes new copies; the earlier ones stay as they are, with whatever you changed. |
| Looking before getting | A listing's page shows everything in it: each Character's instructions and greetings, each library's folders, notes and files, each profile's blocks, the setup. Nothing is hidden until you get it. |
| Finding | Search over name, summary and tags; filter by kind, category and tag; sort by newest, recently updated, most got (and most starred, milestone 14). |
| Categories and tags | Categories are a short list the admins and moderators keep (a listing has one, or none). Tags are the publisher's, up to 5. |
| The publisher | May change the listing's texts, publish an update, unlist it (hidden, still theirs) and delete it. Deleting a listing leaves everyone's copies alone. |
| Admins and moderators | Both: turn publishing on or off, keep the categories, feature a listing (shown first), and remove any listing with a reason its publisher sees. Reviewing before publication comes in milestone 14; until then publishing is open or off. |
| "Based on" | A listing published from a copy you got names the listing it came from. |
| Limits | A listing: at most 25 MB with its files, 12 Characters, 5 libraries, 500 entries a library, 10 structure profiles. Admins and moderators can lower the size. Publishing is rate-limited per member. |
| Instance content | Stays as it is: what an admin publishes "for everyone" (instance model profiles, Characters, structure profiles) is built in and live. Explore is for members' own work, as copies. |

## 2. What changes underneath

- **A package** (`shared/utils/package.ts`): one description of content that can be copied between people. Characters (every field of milestone 9, the avatar), libraries (folders, notes with tags, files), structure profiles, and an optional setup; items refer to each other by keys inside the package, never by database ids. Milestone 12's chat file is for chats; this is for what chats are made from.
- **Two functions** (`server/utils/explore/`): `takePackage` builds a package from a member's items or from a folder's defaults, pulling in what they refer to (a lane's Character, a Character's libraries); `givePackage` makes a member's copies from a package, in one transaction, with new ids throughout.
- **Files are copied, not shared.** Publishing copies each library file and avatar into storage owned by the listing's version; getting copies them again into the member's library. So deleting a source, a listing or a copy never breaks another.
- **A listing is untrusted content for whoever gets it.** It is checked against the package shape and the limits when published; descriptions are shown with the same Markdown renderer as answers (no raw HTML); files keep the upload rules (types, sizes) and are served as downloads or sandboxed, as library files are.

## 3. Schema

| Table | Content |
|---|---|
| `listing` | `id`, `ownerId` (cascade), `kind`, `name`, `summary` (200 characters), `description` (Markdown), `tags`, `category`, `status` (`listed`, `unlisted`, `removed`), `statusReason`, `featured`, `currentVersionId`, `basedOnId`, `gets` (a count kept with each first get), `publishedAt` |
| `listingVersion` | `id`, `listingId` (cascade), `number`, `notes`, `content` (the package), `size`, `createdAt` |
| `listingFile` | `versionId`, `fileId`: the files a version owns, for reading them and for removing them with it |
| `acquisition` | `userId`, `listingId`, `versionId`, `created` (the ids of the copies made), `createdAt`: what a member got, and which version |
| settings | `explore`: `{ publishing: on \| off, categories: [], maxSizeMb }` |

A banned member's listings are hidden while the ban lasts. A deleted member's listings go with the account; copies others made stay.

## 4. API

| Route | Purpose |
|---|---|
| `GET /explore/listings` | the grid: `q`, `kind`, `category`, `tag`, `sort`, a page at a time |
| `GET /explore/listings/:id` | a listing with its current version's content for the preview, its versions and notes, its publisher, and whether you have it and at which version |
| `POST /explore/listings` | publish: the texts, and the source (`characterIds`, `libraryIds`, `structureProfileIds`, or a `folderId` for a pack) |
| `POST /explore/listings/:id/versions` | publish an update: a source and a note |
| `PATCH /explore/listings/:id` | publisher: texts, tags, category, listed or unlisted. Admins and moderators: `featured`, removal with a reason, restoring |
| `DELETE /explore/listings/:id` | publisher, admins and moderators |
| `POST /explore/listings/:id/get` | get: makes the copies, returns what was made |
| `GET /me/listings` | your listings, whatever their status |
| `GET /explore/settings`, `PATCH …` | admins and moderators |
| `GET /files/:id` | also serves a listed version's files to members, and any version's to its publisher and to admins and moderators |

## 5. Frontend

- **`/explore`**: a search box, kind tabs, category and tag filters, a sort select, and a grid of cards: avatar or kind icon, name, summary, publisher, kind, tags, how many got it. Featured listings first. In the sidebar, under "Shared with me".
- **`/explore/:id`**: the name, publisher, counts and "Get" (or "You have this", with "Get the new version" when there is one); the description; "What is inside", the preview; the versions with their notes; what it is based on. It arrives with its data, as a chat does; the grid loads in the browser.
- **Publishing**: "Publish to Explore…" on a Character, a library and a structure profile, and in a folder's menu for a pack. One dialog: name, summary, description, category, tags, and a list of what will be included and what will not (a library that is not yours).
- **`/explore/mine`**: your listings with their status and counts; update, unlist, delete; a removed listing shows the reason.
- **After "Get"**: a note of what was made, with links (the Character, the library, the folder).
- **`/admin/explore`**, for admins and moderators: publishing on or off, the categories, the size limit; every listing, with Feature and Remove.

## 6. Phases

| # | Work | Done when |
|---|---|---|
| 13.P | Spike O, below | the package holds everything and the copy costs are known |
| 13.1 | The package: its shape, `takePackage` (from items and from a folder's defaults), `givePackage`, the file copies, the limits. No screen. | tests: a Character with a lorebook library, a file and an avatar, and a three-model group folder, each taken and given to another member, come out equal field by field with new ids; a library that is not the publisher's is left out and reported; each limit refuses |
| 13.2 | Listings: the tables, publishing, updates, unlisting, deleting, the abilities, publishing on or off, removal by admins and moderators; the "Publish to Explore…" dialogs; `/explore/mine` | tests for every route against publisher, member, moderator, admin and a banned member; in Chromium: a Character and a folder are published, an update adds version 2 with its note, a moderator removes one and the publisher sees the reason |
| 13.3 | Explore: the grid with search, filters and sorts, the listing's page with the preview, "Get", "You have this" and the new-version notice, the counts, the sidebar entry | tests for the queries (search, each filter, each sort, hidden statuses, a banned publisher); in Chromium with two accounts against a fixture: the second member finds the pack by a word in its summary, reads an Engineer's instructions before getting, gets it, and "New chat here" in the new folder starts a group chat whose requests hold the Engineer's and the Designer's instructions |
| 13.4 | `/admin/explore` (the setting, categories, featuring), a smoke step, the live run | in Chromium: with publishing off, members can browse and get but not publish; a featured listing comes first. Live through `scripts/app-smoke.ts`: publish a pack, get it as a second account, and one round of its group chat on each platform |

Built (13.1):
- `shared/utils/package.ts`: `packageSchema` and `PACKAGE_LIMITS`. A package holds `characters` (every field of milestone 9, the card's leftover fields, `libraryKeys`, `avatarKey`), `libraries` (name, description, lorebook options, and entries: folders, notes with their lore, files, parents before children), `structureProfiles`, `files` (name, type, size; the bytes are stored beside the package under each key), and a `setup` shaped as a folder's defaults. Items name each other by keys (`c1`, `l1`, `e1`, `p1`, `f1`); auto-fetch's folders are entry keys. The schema refuses a key used twice, a reference to a key not in the package, an entry before its folder, a file used twice or by nothing, an empty package, and each limit, saying which. Files keep the upload rules (types, 8 MB each).
- The library field schemas (`libraryNameSchema`, `entryNameSchema`, `tagsSchema`, `noteContentSchema`, `libraryDescriptionSchema`) moved from `server/utils/library/libraries.ts` to `shared/utils/libraryFields.ts`, so the package and the library routes share them; the six routes import them from there.
- `server/utils/explore/package.ts`:
  - `takePackage(db, userId, { characterIds, libraryIds, structureProfileIds, folderId })`: what is asked for must be the member's (else not found); what it refers to (a lane's Character, a Character's libraries, the setup's libraries, profile and "who you are") comes along when it is theirs, and is left out and reported when not (a library shared with them, an instance Character or profile). A lane started from a model profile carries the profile's fields under its own. Over 25 MB is refused with 413, the rest with 400. Returns the package, where each file is stored, and what was left out.
  - `givePackage(db, store, { userId, content, paths, folderName })`: copies the files first, as uploads are stored (avatars under the new Character, library files under the new library), four at a time; then writes every row in one transaction, one insert per table, the entries one per library; a setup becomes a folder named `folderName` whose defaults name the new copies. If the transaction fails, the copies are removed. Returns the ids made.
  - `copyFiles` and `removeFiles`, for publishing's own copies in 13.2. The store is passed in, with `blob`'s shape.
- Tests (`test/package.test.ts`): a Character with a lorebook library (a folder, notes with lore, a file) and an avatar, and a three-model group folder (a lane with a Character, one from a model profile with its Character, a plain one; a structure profile, "who you are", auto-fetch folders), each taken, given to another member and taken again from the copies: the same package, field by field, the copies under new ids and the receiver's, the files copied byte for byte. A library shared with the publisher is left out and reported, and not found when asked for. Each limit refuses (13 Characters, 6 libraries, 501 entries, 11 profiles, 28 MB of files), and so does an empty package.

## 7. To verify before building

- **Spike O, packages and copies.** A throwaway `takePackage` and `givePackage` over real data from the dev database: what a full Character of milestone 9 and a library with files weigh; how long copying a 20 MB library takes through the S3 driver (it has no server-side copy here: each file is read and written, as "Add to library" already does); whether one transaction can hold a pack of 12 Characters and 5 libraries with the database a quarter of a second away, or the copies must be made in steps with cleanup on failure.

  Found (2026-11-26, `model-chat-studio-prep/scripts/spikes/m13/packages.ts`). The dev database holds no Characters, libraries, profiles or folder defaults (the smoke runs delete theirs), so the content is spike K's real card and lorebook, read through the app's card and lorebook readers and scaled to the limits:
  - **Weights.** The Seraphina card as a Character, every field of milestone 9 with the card's leftover fields, is 4.0 KB of JSON; its avatar is 500 KB. The Eldoria lorebook's notes average 1.6 KB each (the largest 2.1 KB). A pack at the limits (12 Characters, 5 libraries of 500 notes, a setup of three lanes) is 3.9 MB of JSON before files, its 12 avatars 5.9 MB more. So the 25 MB limit is mostly files, and a version's package fits in `jsonb` comfortably.
  - **Files.** Through the S3 driver on dev, a copy (read, then written) runs at 1.0 MB/s one file at a time and 2.4 MB/s four at a time: 20 MB of library files in 8.3 s, one 8 MB file in 2.8 s. Copies read back equal. A listing at 25 MB costs about 10 s to publish and again to get.
  - **The transaction.** The database is 229 ms away (median of ten; the first, with the connection, 1.2 s). The limits' pack written in one transaction with a statement per table (2,500 notes in five statements, sent together), the package stored as a version's `jsonb`, took 6.2 s, and rolled back cleanly. Row by row, 100 notes took 21.8 s: 2,500 would take about 9 minutes.
  - **So, for 13.1:** `givePackage` and publishing copy the files first, four at a time, then write every row in one transaction, one insert per table (the notes one per library, within Postgres's 65,535 parameters); if the transaction fails, the copied files are removed, as the chat import does. Never a statement per row. A listing's page carries the whole package for the preview; at the limits that is 3.9 MB, which is acceptable for a rare worst case.

## 8. Ceilings and things left out

- No in-place update: a new version means new copies. Chats and folders keep using the copies they already name.
- No comments, no ratings other than stars (milestone 14), no download counts over time.
- No cover images or screenshots: a listing shows its Character's avatar or its kind's icon.
- A listing cannot be downloaded as a file or brought from another instance. A Character can leave as a card (milestone 9).
- Chats are not published. A pack carries a setup, not a conversation.
- Search is by words in the name, summary and tags, not in the content.
- A setup's models are named by this platform's model ids; on another platform they fall back to the default model.
