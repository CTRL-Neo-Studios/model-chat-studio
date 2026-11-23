# Milestone 7: folders with a page and fuller defaults; group speakers see charts

Status: 7.1 to 7.3 built; the milestone's live run is left. Part of `roadmap-milestones-7-14.md`. No migration.

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
- **Folder page.** Breadcrumb of the folders above; the folders inside; the chats (pinned first, then newest), with the menu they have in the sidebar; a "Defaults" card naming the libraries, profile, models, mode and Character, with Edit; the new-chat prompt at the top. Opened from "Open folder" in the folder's sidebar menu and from the breadcrumb; a click on a folder row still expands it. Built from the folders and chats the sidebar already holds.
- **Group chats.** `groupThread` gives a speaker the others' charts as text after their answer: the chart's title, type and data as JSON, at most 4,000 characters a chart. Reasoning and other tool calls stay with whoever made them.

## 4. API

| Route | Change |
|---|---|
| `PATCH /folders/:id` | `defaults` takes the new fields; each id is checked as at chat creation |
| `POST /chats` | fills `models`, `mode`, `userCharacterId` and `settings` from the folder's defaults when absent |
| `GET /folders/:id/start` | new (7.1): what a new chat in the folder starts with |

## 5. Phases

| # | Work | Done when |
|---|---|---|
| 7.1 | Fuller defaults: schema, the dialog's new fields, "Use this chat's setup", the home page starting from them, `POST /chats` filling what is absent | tests for the fill and for each "goes missing" rule; in Chromium against a fixture platform: a folder set from a two-model group chat starts a new chat with the same two models, group mode, Character and web search, and the fixture receives them; a folder without defaults starts as the home page does |
| 7.2 | The folder page and "Open folder" | in Chromium: the page lists a folder's chats and sub-folders, starts a chat in it from its prompt, and edits its defaults; a reload arrives with skeletons, a click from the sidebar with its data |
| 7.3 | Group speakers see the others' charts | a test for the thread builder; the fixture's second request holds the first speaker's chart data under its name |

Built (7.1): `folderDefaultsSchema` takes `models` (`newLaneSchema`, moved to `shared/utils/chat.ts`), `mode`, `userCharacterId` and `settings`; `nearestWithDefaults` returns the folder the defaults come from (`nearestDefaults` is gone). `folderStart` (`server/utils/chat/folderStart.ts`) applies the "goes missing" rules once, for both `POST /chats` (what the request leaves out) and the new `GET /folders/:id/start`, which the new-chat screen reads instead of working the rules out itself; it also returns the lanes as the values they start with. `PATCH /folders/:id` checks the models and Character as chat creation does. The dialog sets models (by profile; lanes with fields of their own come from a chat), the answers' mode, who you are and web search; other chat settings copied from a chat are kept and said so. "Use as the folder's defaults…" sits in the menu of a chat inside a folder and opens the dialog filled with that chat's setup, to review before saving. Fixture check in Chromium (DeepSeek fixture): a two-model group chat (Engineer, Designer) with Captain and web search, used as "Work"'s defaults; `/?folder=` showed "2 models in a group"; the new chat was in the folder, group, Captain, web search on, lanes Engineer/blue and Designer/pink, and the requests held "This is a group chat. You are Engineer…", "The user is Captain.", "Captain: Plan the release" and DeepSeek's web search tools; a folder without defaults showed the home page's models with "A new chat in “Plain 71”." NuxtHub's schema type cache had to be cleared again (`FolderDefaults` lives outside the schema file).

Built (7.2): `/folders/:id` (`app/pages/folders/[id].vue`) is the new-chat screen with the folder around it: `NewChat` takes `folderId` (the home page passes `?folder=`) and two slots, the heading and what goes under the prompt. Under it: "Defaults for new chats" (what `GET /folders/:id/start` resolves, with where they come from and Edit), the folders inside, the chats (pinned first, then newest) with their sidebar menus. No `GET /folders/:id`: the sidebar already holds every folder and chat, so a click shows the page at once and a reload shows skeletons until they load. The menus moved from `SidebarChats.vue` to `useFolderActions`, which both use; it adds "Open folder", leaves a deleted folder's page for its parent, and after saving defaults reads every folder's start again. The prompt now reads the start afresh on opening instead of taking a cached one (a cached start could predate an edit of the defaults, which 7.1 would have used), and starts afresh when the defaults change under it. Check in Chromium (DeepSeek fixture): "Open folder" showed the page with its data and no skeleton; the server-rendered page held the skeletons; "Set defaults…" from the card saved "You are: Nobody" and web search on, and the card showed them; the prompt started a chat that was in the folder with web search on and nobody as the user, and it was listed on the page; the sub-folder's page had the breadcrumb and "From “Check 7.2 Parent”, a folder above."; deleting the sub-folder from its own page went to the parent's.

Built (7.3): `groupThread` (`server/utils/chat/group.ts`) gives the others' answers as their text with each chart in place, `[chart]` and the chart's input as JSON (title, type, data, series), cut at `MAX_SHARED_CHART` (4,000) characters; a chart whose call failed and every other tool call stay with whoever made them, and an answer that is only a chart now reaches the others. A test covers the order, the cut and what stays out. Fixture check in Chromium (DeepSeek fixture): in a group chat the Engineer drew a bar chart and wrote "Sales are rising."; the Designer's request held "Engineer: Here is the chart. [chart] {…"Fixture sales"…} Sales are rising.".

## 6. Ceilings and things left out

- No description, icon or colour on a folder.
- Defaults are not merged up the tree, and a folder cannot say "none" for one field while a folder above supplies it: the nearest folder with defaults gives all of them.
- Moving a chat into a folder changes nothing in the chat.
- A folder is not shared. Chats are, one by one.
