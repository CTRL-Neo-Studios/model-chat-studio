# Milestones 15–17: Unpublish, areas with their own sidebars, Content Packages

Status: planned (2026-11-26); nothing built. Follows `roadmap-milestones-7-14.md` (complete). One migration (`0025_content_packages`, in 17.1). The conventions of milestone 1 and the way of working so far apply: one phase per step, a check in Chromium for each phase, a live run where the API changes (milestone 17).

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
