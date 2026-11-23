# Milestone 7: folders with a page and fuller defaults; group speakers see charts

Status: planned. Part of `roadmap-milestones-7-12.md`. No migration.

Goal: a folder can be a place to work in, the way a project was, without becoming one. It still only organises chats unless you give it defaults.

## 1. Decisions

| Topic | Decision |
|---|---|
| What a folder is | An organiser, as today. Defaults are optional; a folder without any starts chats exactly as the home page does. Nothing is owned by a folder: libraries, profiles and Characters stay attached to chats. |
| Defaults today (5.3) | Libraries and a structure profile. |
| Defaults added | The models (lanes), the mode (separate or group), who you are (your Character), and the chat settings (web search, memory, layout, file tools, auto-fetch). |
| Which folder's defaults | Unchanged: the folder's own, else the nearest folder up the tree that has any. One folder gives all of them; fields are not mixed between folders. |
| When they apply | When a chat starts in the folder. They are a copy: changing the defaults later changes no existing chat, and everything stays editable before the first message. |
| Setting them | In the "Defaults…" dialog, and by "Use this chat's setup as the folder's defaults" on a chat inside the folder. |
| Folder page | `/folders/:id`: the folders inside it, its chats, its defaults at a glance, and the prompt to start a chat there. |
| What goes missing | A default that no longer resolves is skipped: a profile or Character deleted or no longer yours to use, a library you left. No model left: the default model. Group mode with fewer than two models: separate answers. |
| Group chats | A speaker also sees the others' charts (generated images follow in milestone 10). |

## 2. Defaults

`folderDefaultsSchema` (`shared/utils/folderDefaults.ts`), stored in `chatFolder.defaults` as now. Every new field is optional, so existing rows stay valid.

| Field | Content |
|---|---|
| `libraryIds`, `structureProfileId` | as today |
| `models` | up to 12 lanes in order, each a profile to start from (`profileId`) or lane fields (model, name, colour, prompt, settings, Character): the shape `POST /chats` already takes (`newLaneSchema`) |
| `mode` | `separate` or `group` |
| `userCharacterId` | a Character, or `null` for nobody; absent: your own default from Settings |
| `settings` | the chat settings (`chatSettingsSchema`): web search, memory length, layout, file tools, auto-fetch; auto-fetch's folders refer to the default libraries' entries |

"Use this chat's setup" copies the chat's libraries, structure profile, lanes (as lane fields, with the profile they came from), mode, your Character and settings.

## 3. Behaviour

- **Home page with `?folder=`** (and the folder page's prompt): the lanes, mode, Character and settings start from the defaults instead of from the last chat's; libraries and the structure profile as today. Sending waits until they have loaded, as today.
- **`POST /chats`** with `folderId`: what the request leaves out comes from the defaults, as 5.3 does for libraries. `models` becomes optional when the folder supplies them.
- **Folder page.** Breadcrumb of the folders above; the folders inside; the chats (pinned first, then newest), with the menu they have in the sidebar; a "Defaults" card naming the libraries, profile, models, mode and Character, with Edit; the new-chat prompt at the top. Opened from "Open folder" in the folder's sidebar menu and from the breadcrumb; a click on a folder row still expands it.
- **Group chats.** `groupThread` gives a speaker the others' charts as text after their answer: the chart's title, type and data as JSON, at most 4,000 characters a chart. Reasoning and other tool calls stay with whoever made them.

## 4. API

| Route | Change |
|---|---|
| `PATCH /folders/:id` | `defaults` takes the new fields; each id is checked as at chat creation |
| `POST /chats` | fills `models`, `mode`, `userCharacterId` and `settings` from the folder's defaults when absent |
| `GET /folders/:id` | new: the folder, its path, the folders and chats inside it |

## 5. Phases

| # | Work | Done when |
|---|---|---|
| 7.1 | Fuller defaults: schema, the dialog's new fields, "Use this chat's setup", the home page starting from them, `POST /chats` filling what is absent | tests for the fill and for each "goes missing" rule; in Chromium against a fixture platform: a folder set from a two-model group chat starts a new chat with the same two models, group mode, Character and web search, and the fixture receives them; a folder without defaults starts as the home page does |
| 7.2 | The folder page and "Open folder" | in Chromium: the page lists a folder's chats and sub-folders, starts a chat in it from its prompt, and edits its defaults; a reload arrives with skeletons, a click from the sidebar with its data |
| 7.3 | Group speakers see the others' charts | a test for the thread builder; the fixture's second request holds the first speaker's chart data under its name |

## 6. Ceilings and things left out

- No description, icon or colour on a folder.
- Defaults are not merged up the tree, and a folder cannot say "none" for one field while a folder above supplies it: the nearest folder with defaults gives all of them.
- Moving a chat into a folder changes nothing in the chat.
- A folder is not shared. Chats are, one by one.
