# Milestones 15–17: Unpublish, areas with their own sidebars, Content Packages

Status: milestones 15 and 16 built (2026-11-26); 17.1 next. Follows `roadmap-milestones-7-14.md` (complete). One migration (`0025_content_packages`, in 17.1). The conventions of milestone 1 and the way of working so far apply: one phase per step, a check in Chromium for each phase, a live run where the API changes (milestone 17).

Goal: publishing can be undone from where the item is; the app is split into areas (chat, content, settings, admin), each with its own sidebar and a breadcrumb to move around, with one "Content" place for Explore and everything the member made; and a pack becomes a thing of its own, a Content Package, made and published from a studio.

## 1. Decisions

Your answers (2026-11-26):

| Topic | Decision |
|---|---|
| What a package holds | It points at the member's Characters, libraries and structure profiles. Publishing copies them as they are then, as every listing does today. |
| Single items | A Character, a library or a structure profile is still published on its own from its menu. Packages are for several items or a chat setup. |
| A folder's "Publish to Explore…" | Becomes "Make a package from this folder": it makes a package filled from the folder's setup, published from the studio. |
| Unpublish | Reversible: off Explore, the listing kept with its versions, stars and gets, and it can be put back. Today's "Unlist", renamed and offered where the item is. Delete stays separate. |
| Addresses | Move under `/content`; the old ones redirect. |
| Areas with their own sidebar | Chat, Content, Admin, Settings (Model profiles move there), and inside a library. |
| Moving between areas | No visible switch (no tabs). The separation is felt, not shown: the sidebar is simply the area's. At most a dropdown. |

Mine, to overrule if wrong:

| Topic | Decision |
|---|---|
| How one gets from area to area | Three ways, none of them a switch: a "Content" row in the chat sidebar; a "back" row at the top of every sidebar but chat's, leading to its parent; and the breadcrumb's first segment, which opens a dropdown of the areas (the "dropdown of sorts"). The site's name always leads to a new chat. Settings and Admin stay in the user menu. |
| "Shared with me" | A section of the chat sidebar under the member's own chats, as your note suggests, not a page. `/shared` redirects to `/`. |
| Pages for items | A Character and a structure profile each get a page (their editors leave their dialogs). A Character's five tabs become its sidebar. Model profiles keep their dialog, in Settings. |
| Order | Unpublish first (small, needs nothing), then navigation, then packages (the studio is built on the new frame). |
| Deleting a package | Deletes its listing with it, said in the confirmation. Copies people got stay theirs. |

## 2. What changes underneath

- **Areas.** The layout keeps one `UDashboardSidebar` (same id, so its width and collapsed state carry across areas) and fills it by area. One function, `areaOf(route)` in `app/utils/areas.ts`, maps a path to its area by longest prefix; each area is a component (`SidebarChat`, `SidebarContent`, `SidebarSettings`, `SidebarAdmin`, and one per thing opened: `SidebarLibrary`, `SidebarCharacter`, `SidebarPackage`). Nothing else decides what the sidebar shows.
- **Addresses.** Pages move; the API does not (`/api/v1/explore/…`, `/api/v1/characters`, … stay). Old page addresses redirect through `routeRules`. About 40 hard-coded paths in 16 files change (`app/pages/explore/[id].vue`, `UserMenu.vue`, `AdminPanel.vue` hold most).
- **A package as a listing's source.** A listing remembers what it was published from (`listing.source`) so "Publish an update" can read it again. `packageSourceSchema` gains `packageId`; `takePackage` reads a package's items and setup where it reads a folder's today. Publishing, versions, review, stars and reports are untouched. Both databases hold no listing today (checked 2026-11-26: dev 0, production 0), so `source.folderId` can go without a data migration.

## 3. Milestone 15: Unpublish

Today "Unlist" exists only in the menu on "Your listings", itself only in the user menu and Explore's header. Nothing on a Character, a library or the listing's own page says it is published.

### Behaviour

- Wording: "Unlist" becomes **Unpublish**, "List on Explore" becomes **Put back on Explore** (not "Publish again", which is the resubmission after a rejection), the badge "Unlisted" becomes "Unpublished". The stored status stays `listed`/`unlisted`: no migration.
- Putting back needs no review, as now: what it holds did not change. A listing removed by a moderator cannot be put back.
- An item knows its listing: `/me/listings` already returns each listing's `source`, so the lists map an item's id to the listing published from it alone. No API change.

### Frontend

- Characters, Libraries, Structure profiles (and a folder with a setup, until 17.3): a row whose item is published shows a "Published" (or "Unpublished", "Waiting for review", "Rejected", "Removed") badge, and its menu offers "Open on Explore", "Publish an update…" and "Unpublish" / "Put back on Explore" in place of "Publish to Explore…". This also ends publishing the same item twice by accident.
- The listing's page, for its publisher: "Unpublish" / "Put back on Explore" beside "Your listings".
- "Your listings": the same two actions under their new names.

### Phases

| Phase | Deliverable | Done when |
|---|---|---|
| 15.1 | The wording, the state and the actions on the item rows, the listing page and "Your listings" | a test that an unpublished listing keeps its versions, stars and gets and comes back as it was (added to `test/listings.test.ts` if not there). In Chromium with two accounts: a published Character's row says "Published"; "Unpublish" from that row hides it from the other member (the grid, and its address answers 404); "Put back on Explore" from the listing's page shows it again with its star |

Built (15.1):
- `app/composables/useListingActions.ts`: `listingState` (Published, Unpublished, Waiting for review, Rejected, Removed: the badge "Your listings" had, moved here and renamed), `useMyListings().listingOf(source)` (the newest listing published from exactly an item's ids, or a folder's), `setPublished` (was `setListed`; its toasts "Unpublished: only you see it" and "Back on Explore"), `listingActions` (Edit listing…, Publish an update… or again…, Unpublish or Put back on Explore; none once removed) and `publishActions(source, name)` (an item's menu group: "Publish to Explore…", or "Open on Explore" and its listing's actions). Every action now refreshes Explore's queries as well as the publisher's list, so the listing's page follows.
- `PublishedBadge.vue` on the rows of Characters, Libraries (owned) and Structure profiles; their menus and a folder's (with a setup) use `publishActions`, so an item published once no longer offers "Publish to Explore…" again. Folders show no badge in the sidebar's tree.
- The listing's page: "Unpublish" / "Put back on Explore" for its publisher beside "Your listings"; the alert reads "Unpublished". "Your listings" uses the same state and actions; `/admin/explore` and `/admin/review` say "Published" and "Unpublished".
- Test (`test/listings.test.ts`): unpublished, a listing with two versions, a star and a get leaves the other member's grid and is refused to them, its versions, stars and gets kept; put back, it is in the grid as it was.

Check in Chromium with two accounts: a member published a Character from its row ("Published to Explore"); the row showed "Published" and its menu Open on Explore, Edit listing…, Publish an update…, Unpublish, without "Publish to Explore…". The other member starred it. "Unpublish" from the row turned the badge "Unpublished" (about 1.5 s); the other member's grid lost it and its address answered 404. On the listing's page (alert "Unpublished"), "Put back on Explore" answered "Back on Explore", the alert went and the button became "Unpublish" (about 2.5 s); the other member found it again, starred, with its 1 star. Both members were deleted.

## 4. Milestone 16: areas, sidebars, breadcrumbs

Changes no feature and no API.

### The areas

| Area | Pages | Its sidebar | Back row |
|---|---|---|---|
| Chat | `/`, `/chat/:id`, `/folders/:id`, `/temporary` | New chat, Temporary chat, Import chat…, Search; "Content" with the count Explore has today; folders and chats; "Shared with me" | none: it is the root |
| Content | `/content` and the lists under it | Explore, Your stars; "My content": Characters, Libraries, Structure profiles, Packages (17), Published (with the count of rejected or removed); for admins and moderators, "Review" with what waits | ← Chat |
| A library | `/content/libraries/:id` | its files and notes tree (`LibraryFiles`' tree, moved out of the page), with upload, new note, new folder | ← Libraries |
| A Character | `/content/characters/:id` | Instructions, Greetings, Examples and note, Lorebook, About (the editor's tabs today) | ← Characters |
| A package (17) | `/content/packages/:id/…` | Overview, Items, Setup, Listing, Versions; the publish action | ← Packages |
| Settings | `/settings/…` | Usage and keys, Chat, Your data, Model profiles | ← Chat |
| Admin | `/admin/…` | Users, Explore, Review (with its count), Invites, Models, Settings: `AdminPanel`'s tabs, which go | ← Chat |

A structure profile's page and an Explore listing's page keep the Content sidebar: they have no sections of their own.

On a phone the sidebar is the slide-over it is today, with the same contents by area. A temporary chat still collapses the sidebar and restores it.

### Breadcrumbs

One component, `Crumbs.vue`, in every page's top bar, built from the route and the page's own name: `Content › Characters › Ignathius`.

- The first segment opens a dropdown of the areas (Chat, Content, Settings, and Admin for those who have it).
- A segment with siblings opens a dropdown of them, from the lists the browser already holds (`charactersQuery`, `librariesQuery`, …): the other Characters, the other libraries, the other packages. No new requests.
- In a chat: `Chat › the folder's path › the title`, the title still renamed in place (`ChatTitle`).
- On a narrow screen: the parent and the current segment only.
- The search palette (⌘K) gains the areas and the content lists as links, beside the chats.

### Addresses

| Before | After |
|---|---|
| `/explore`, `/explore/:id` | `/content/explore`, `/content/explore/:id` |
| `/explore/stars` | `/content/stars` |
| `/explore/mine` | `/content/published` |
| `/characters` | `/content/characters`, and `/content/characters/:id` (new) |
| `/libraries`, `/libraries/:id` | `/content/libraries`, `/content/libraries/:id` |
| `/structure-profiles` | `/content/structure-profiles`, and `/content/structure-profiles/:id` (new) |
| `/model-profiles` | `/settings/model-profiles` |
| `/settings` | `/settings` (Usage and keys), `/settings/chat`, `/settings/data` |
| `/shared` | `/` (a sidebar section) |
| `/admin/…` | unchanged |

`/content` itself is a page: what the member has by kind, each with its count and "New…"; what needs them (a rejected or removed listing; for reviewers, what waits); and the newest of Explore with a search box that leads into it. All from queries that exist.

### Phases

| Phase | Deliverable | Done when |
|---|---|---|
| 16.1 | `areaOf`, the sidebar by area for Chat and Content, the `/content` pages with their redirects, the Content page, "Shared with me" as a section, the user menu without the content links | in Chromium: the chat sidebar has no Libraries or Explore but "Content" with its count; opening it shows the Content sidebar with "← Chat"; every old address lands on its new page, a listing's address included; the sidebar keeps its width and collapsed state across areas; a shared chat opens from the sidebar; on a phone-sized window the slide-over shows the area's sidebar |
| 16.2 | Settings and Admin as areas (the settings page split, Model profiles moved, `AdminPanel`'s tabs gone), `Crumbs` on every page with the area and sibling dropdowns, the palette's links | in Chromium: a moderator sees Admin's sidebar without the admin-only entries; from a library, the breadcrumb's dropdown opens another library and its first segment another area; a chat in a nested folder shows its path and is still renamed from the bar; keyboard: every crumb and dropdown reachable and named |
| 16.3 | Pages for a Character and a structure profile (their editors out of the dialogs), a Character's sections and a library's tree as sidebars | in Chromium: a Character is made, edited section by section from the sidebar and saved on its page; an unsaved change asks before leaving; importing a card opens the new Character's page; a library's file is opened, renamed and moved from its sidebar; `scripts/app-smoke.ts` still passes on both platforms (it uses the API only, which did not change) |

Built (16.1):
- Checked first (section 6, items 1 and 2): `routeRules` redirects with `/**` carry the rest of the path and the query on Nitro v3, and an exact rule beats the wildcard beside it (`/explore/stars` → `/content/stars`, not `/content/explore/stars`); no middleware needed. One `UDashboardSidebar` with its contents swapped keeps its width and collapsed state, and the chat tree's drag and drop works after it is mounted again.
- `app/utils/areas.ts`: `areaOf(path)` (`content` under `/content`, else `chat`; Settings and Admin come in 16.2) and `isUnder`. The layout keeps one sidebar and the chats and search palette, and shows `SidebarContent` or `SidebarChat` by area.
- `SidebarChat`: New chat, Temporary chat, Import chat…, Search, "Content" with the count Explore had; the folders and chats (`SidebarChats`); `SidebarShared`, "Shared with me" under them, each row's menu saying who shared it and whether the member reads or edits, with "Leave". `/shared` is gone.
- `SidebarContent`: "Chat" back, Overview, Explore, Your stars; "My content": Characters, Libraries, Structure profiles, Published (with `attention`), and for admins and moderators Review (with `waiting`). A row stays lit on the pages under it.
- Pages moved under `/content` (`explore/index`, `explore/[id]`, `stars`, `published` (was `explore/mine`, titled "Published"), `characters`, `libraries/index`, `libraries/[id]`, `structure-profiles`); `nuxt.config.ts` redirects the old addresses (`/shared` to `/`). Every link in the app points at the new ones. Explore's header lost "Your stars" and "Your listings" (the sidebar has both). The user menu lost Characters, Structure profiles and Your listings.
- `/content`: what needs the member (a rejected or removed listing; for reviewers what waits), "My content" (Characters, Libraries with how many are shared, Structure profiles, Published with how many are on Explore, Your stars with its lists), each card opening its list and the first three with "New…" (`?new`, handled by `useNewFromLink`, which opens the list's "new" dialog once and drops `new` from the address); "New on Explore", six cards, a search into Explore and "All of Explore".

Check in Chromium with two members and the admin: a member had a folder, a loose chat and a Character published and then removed by the admin; another shared a chat with them. The chat sidebar listed New chat, Temporary chat, Import chat…, Search, "Content 1", Folders, Today, and "Shared with me" with "Trip plans", which opened the shared chat. "Content" showed the Content sidebar ("Chat", Overview, Explore, Your stars, My content, …, "Published 1") and the page with the removed listing's alert and the counts. `/explore`, `/explore/<listing>`, `/explore/stars`, `/explore/mine`, `/characters`, `/libraries`, `/structure-profiles` and `/shared` each landed on its new page. The sidebar dragged to 300 px in Content stayed 300 px in Chat; collapsed in Chat (64 px) it stayed collapsed in Content, with the rows as icons. Back in Chat, the loose chat dragged onto the folder moved into it. "New…" on the Characters card opened "New Character", the address without `new`. At 390×844 the menu opened the Content sidebar on Libraries (Libraries lit) and the chat sidebar on `/`. The admin's Content sidebar had Review. Both members were deleted.

Built (16.2):
- Checked first (section 6, item 3): `UBreadcrumb` takes a slot per item, so a dropdown per segment fits; the trail is a small list of its own (`Crumbs.vue`) with a `UDropdownMenu` per segment, the same amount of code and plain to read.
- `app/utils/areas.ts`: `AREAS`, every area's name, first page and pages (with `heading` for a sidebar group, `exact` for a first page whose address is the area's, `minRole` for moderators or admins), read by the sidebars, the breadcrumb and the palette; `areaOf` now knows Settings and Admin; `sectionsOf`, `sectionOf`, `allowed`.
- `SidebarArea` (replacing `SidebarContent`) for Content, Settings and Admin: "Chat" back, the area's pages by role, Published and Review with their counts. `AdminPanel` lost its tabs; a moderator's Admin sidebar has Users, Explore and Review.
- Settings split: `/settings` (Usage and keys), `/settings/chat` (stopping a regenerated answer, you in new chats, read aloud), `/settings/model-profiles` (moved; `/model-profiles` redirects), `/settings/data` (exporting your chats). The user menu: Content, Settings, Admin (Model profiles left it).
- `Crumbs`: the area (a dropdown of the areas the member may open), the area's page (a dropdown of its pages), and what is open: a library (a dropdown of the libraries), a listing, a chat's title (the `current` slot, its rename menu as before), with the folders a chat or folder is in as links. Each dropdown lists every entry, the current one in the primary color; each is named with its label and what it lists ("Libraries, pages of Content"). The last two segments only on a narrow screen; a guest reading a chat by link sees its title alone. `PageNavbar` puts it in every page's bar (in `left`: the title slot is a heading, which cannot hold a nav), with the page's buttons and light or dark; the chat and new-chat bars hold it before the models menu. The back arrows of a library and a listing went.
- The search palette's links: "Go to" (New chat), then a group per area of its pages, by role (a group each, as the palette shows 12 results a group; Review once).

Check in Chromium with a member and a moderator: from the library "Atlas", the trail read Content › Libraries › Atlas; Atlas's dropdown opened "Bestiary"; the first segment offered the areas and opened Settings, its sidebar Chat, Usage and keys, Chat, Model profiles, Your data. A chat in Trips › Japan read Chat › Trips › Japan › Packing list, the folders linking to their pages; renamed from its title in the bar to "Packing list for Kyoto", the trail and the server had the new name; the folder's page read Chat › Trips › Japan. Keyboard, on a library: Tab reached "Content, areas", "Libraries, pages of Content" and "Atlas, libraries" (the current page); Enter opened a dropdown, the arrows moved, Escape closed it and gave the focus back. The moderator's Admin sidebar had Users, Explore and Review, `/admin/settings` sent them home, and the palette (from "Search") had Content, Settings and Admin (Users, Explore) groups; typing "users" and Enter opened Users. Both members were deleted.

Found during the check: under `nuxt dev`, Nuxt DevTools' embedded script stops ⌘K before the palette sees it (`__devtools/embedded.js`, `stopPropagation`); ⌘O works, and a production build has no DevTools. The palette opens from "Search" in development.

Built (16.3):
- Checked first (section 6, items 4 and 5): a Character's sections are one page with `?section=`, not sub-routes, so the draft lives while the sidebar switches sections and a section change is not leaving; `LibraryFiles` was a tree beside a viewer joined only by the open entry, already in the address (`?entry=`), so it splits without losing selection, upload by drop, or a viewer's read-only tree.
- `sidebarOf(path)` in `areas.ts` (a library's or a Character's own sidebar, else the area's), with `CHARACTER_SECTIONS`; the layout shows `SidebarLibrary`, `SidebarCharacter`, `SidebarArea` or `SidebarChat` by it.
- `/content/characters/[id]` (and `new`, `?instance=1` for an admin's): the editor out of its dialog (`CharacterEditor.vue` gone), name and color always, then the section; Save in the bar with "Not saved" beside it; the avatar uploads after the Character is saved. An instance Character is read-only for members (a disabled fieldset, with a note). `SidebarCharacter`: "Characters" back, the name, the five sections. The list's cards link to the pages; "New Character", "Edit" and an imported card open them.
- `/content/structure-profiles/[id]` (and `new?template=`, `?instance=1`): the editor out of its dialog (`StructureProfileEditor.vue` gone), with the Content sidebar. A new profile counts as unsaved until saved.
- `useUnsavedGuard`: leaving a page with unsaved changes asks ("Leave without saving?", Leave or Cancel), and closing or reloading the tab gets the browser's prompt; a change of the query alone is not leaving. `ModalConfirm` gained `confirmLabel`.
- The library: `LibraryFiles` became `LibraryTree` (the tree, reading and writing `?entry=`), in `SidebarLibrary` under "Libraries" back and the library's name; the page shows the open entry. The list pages moved to `characters/index.vue` and `structure-profiles/index.vue`.
- `Crumbs`: the last segment of a library, a Character or a structure profile lists the others of its kind.

Check in Chromium with a member: "New Character" opened `/content/characters/new` (Content › Characters › New Character; the sidebar Characters, New Character, its five sections); the name and instructions typed, "Greetings" from the sidebar, a greeting added, back to "Instructions" with the text kept and "Not saved" shown; Save answered "Character added" and the address became the Character's; after a reload the name, instructions and greeting were there. A change, then "Characters" in the sidebar, asked "Leave without saving?" (Leave, Cancel): Cancel stayed with the draft; the breadcrumb's Libraries asked again, Leave went, the server unchanged. Importing "Ignathius (UT).json" opened its page. In a library, the note "Coastline" opened from the sidebar's tree (`?entry=`), was renamed "North coast" and moved into "Maps" from its menu there, the server agreeing and the note still open. "Roleplay" from "New profile" opened a new profile with its seven blocks, unsaved; Save moved to its address without asking; a change and leaving asked. Live through `scripts/app-smoke.ts` on both platforms (the API did not change), every step passed, about $0.0095. Both members were deleted.

## 5. Milestone 17: Content Packages and the studio

Today a pack is published only from a folder's menu, as that folder's setup. A package becomes something the member makes, fills and publishes in its own place.

### Schema (`0025_content_packages`)

`contentPackage`: `id`, `ownerId` (cascade), `name`, `items` (jsonb: `characterIds`, `libraryIds`, `structureProfileIds`, within `PACKAGE_LIMITS`), `setup` (jsonb, a folder's defaults shape, `folderDefaultsSchema`, or null), `texts` (jsonb: summary, description, tags, category: the listing's texts until it has a listing), `listingId` (unique, null until published; set null when the listing is deleted, which makes it a draft again), `createdAt`, `updatedAt`.

### Behaviour

- **Publishing** is the existing `publishListing` with `source: { packageId }` and the package's texts; in the same transaction the package gets its `listingId`. "Publish an update" and "Publish again" are the existing version route: they read the package as it is now. Review mode, the one-submission rule, stars and reports apply as to any listing.
- **Texts** live in one place at a time: on the package while it is a draft, on the listing once published (the existing `PATCH`), so there is nothing to keep in step.
- **What comes along** is as today: a setup's lanes bring their Characters, a Character its libraries, when they are the member's; what is left out is said before publishing (`previewListing`).
- **An item deleted elsewhere** drops out of the package: ids are filtered to what the member still owns when the package is read, and written back at its next save.
- **Getting** a package is unchanged: the member's own copies, and a folder with the setup when it has one. Getting does not make a package on their side.
- **Deleting** a package deletes its listing.
- **From a folder:** `POST /packages` with `fromFolderId` copies the folder's defaults as the setup and its lanes' Characters, libraries and profile as items. The folder is not tied to the package afterwards.
- `source.folderId` and the folder branch of `takePackage` are removed in 17.3, once no listing uses them (none does today).

### API

| Route | What it does |
|---|---|
| `GET /packages` | the member's packages, each with its item counts and its listing's state (as `/me/listings` gives it) |
| `POST /packages` | a new one: `{ name }`, or `{ fromFolderId }` |
| `GET /packages/:id` | one, with its items' names, its setup, its texts, and its listing with every version's state |
| `PATCH /packages/:id` | name, items, setup, texts |
| `DELETE /packages/:id` | it and its listing |
| `POST /explore/listings`, `POST /explore/listings/:id/versions`, `POST /explore/preview` | unchanged, now also taking `source: { packageId }` |

Owner only throughout; another member's package is not found.

### Frontend

- `/content/packages`: the member's packages as cards (name, what it holds, its state: Draft, Published with its version, Waiting for review, Rejected, Unpublished, Removed), and "New package".
- The studio, `/content/packages/:id`, with `SidebarPackage`:
  - **Overview**: what it holds and its size against the limit (`ListingPreview`), what would be left out, its state with the waiting, rejected and removed notices "Published" shows today, and what is still missing before it can be published.
  - **Items**: Characters, libraries and structure profiles picked from the member's own. Each opens its own page with `?package=<id>`, so its back row and breadcrumb lead to the package again.
  - **Setup**: optional. The form of a folder's defaults (`ModalFolderDefaults`' body, shared by both), for the chat the package starts.
  - **Listing**: name, summary, description with its preview, tags, category (the publish dialog's form, inline), and the card as Explore will show it (`ListingCard`).
  - **Versions**: each with its state, notes and reason.
  - The sidebar's action follows the state: "Publish", "Publish an update…", "Publish again…", "Unpublish" / "Put back on Explore".
- "Published" (`/content/published`) still lists every listing; a package's row opens its studio.
- A folder's menu: "Make a package from this folder" in place of "Publish to Explore…".

### Phases

| Phase | Deliverable | Done when |
|---|---|---|
| 17.1 | The migration, `server/utils/explore/packages.ts`, the routes, `packageId` as a source; `/content/packages` and the studio's Overview and Items | tests (`test/packages.test.ts`): another member's package is not found for reading, changing or deleting; a package's items and setup are taken as a folder's were; a deleted item drops out; within the limits. In Chromium: a package is made, two Characters and a library are added, the Overview shows what it holds and its size |
| 17.2 | Setup, Listing, Versions, and publishing from the studio | tests: publishing links the listing; an update reads the package as it is now; in reviewed mode it waits, and a second update is refused; deleting the listing makes it a draft; deleting the package deletes the listing. In Chromium with two accounts: a package with a group setup is published from the studio, the other member gets it and its folder starts the group; an item is changed, an update published, and the other member is offered the new version; "Unpublish" from the studio hides it |
| 17.3 | "Make a package from this folder", `source.folderId` removed, the smoke step, the live run | a test for a package made from a folder. In Chromium: a folder with a setup becomes a package holding its Characters. Live through `scripts/app-smoke.ts` on both platforms: its "explore" step makes the package from the folder, publishes it, and the second member gets it and runs one round of its group |

## 6. To verify before building

1. **Redirects with a wildcard in `routeRules`** on Nitro v3 (`'/explore/**': { redirect: '/content/explore/**' }`), given that Nitro v3 already read one rule differently here (`csurf: false`, see `nuxt.config.ts`). If they do not carry the rest of the path, a small global route middleware does it instead. Before 16.1.
2. **One `UDashboardSidebar` with swapped contents** keeps its saved width and collapsed state, and its mobile slide-over, when the content's component changes on navigation; and the tree's drag and drop (`SidebarChats`) survives being unmounted and mounted again. Before 16.1.
3. **`UBreadcrumb` with a dropdown per segment**: its item slots take a `UDropdownMenu` (the component has per-item `leading`, `label` and `trailing` slots), and the result is reachable by keyboard. Before 16.2.
4. **The editors as pages**: `CharacterEditor` and `StructureProfileEditor` are `UModal`s whose forms close on save; what leaving with unsaved changes needs (`onBeforeRouteLeave`), and whether a Character's sections can be sub-routes or one page with a section in the query. Before 16.3.
5. **`LibraryFiles`** split into its tree and its viewer without losing selection, upload by drop, and what a reader without edit rights sees. Before 16.3.
6. **No listing has `source.folderId`** in either database, again, on the day 17.3 is built.

## 7. Ceilings and things left out

- No visible area switch, by decision. Someone who misses "Content" in the chat sidebar finds it in the breadcrumb, the palette and the user menu's areas.
- A package points at items; it holds no copies of its own. Changing an item changes what the next version of every package and listing holding it will carry.
- An item's page opened from a package leads back to it by `?package=`; opened any other way it leads back to its list.
- Model profiles keep their dialog; they cannot be published and have no page of their own.
- A structure profile's page has no sidebar of its own.
- Getting a package makes copies and a folder, not a package: a member who wants to republish makes their own package from the folder.
- A folder and the package made from it are not kept in step.
- The palette searches chats and links to pages; it does not search Characters, libraries or Explore.
- Sibling dropdowns list what the browser has loaded; a long list is not searched inside the breadcrumb.
- Review still covers a listing's content and not its texts (milestone 14's ceiling), packages included.
