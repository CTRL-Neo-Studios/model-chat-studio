# Milestone 14: Explore's stars, star lists and moderation

Status: complete (2026-11-26): phases 14.1 to 14.3 built, the live run passed. Part of `roadmap-milestones-7-14.md`. One migration (`0024_explore_stars`, written in 14.1). Needs milestone 13.

Goal: members keep what they like on Explore and find it again, as stars and lists work on GitHub; and admins and moderators can require a review before anything is published, and act on what members report.

## 1. Decisions

| Topic | Decision |
|---|---|
| Stars | A member stars a listing with one click. A listing shows how many members starred it, and "most starred" becomes a sort. |
| Star lists | A member makes named lists ("Productivity", "Roleplay worlds") and puts listings in them. Putting a listing in a list stars it. A listing can be in several lists, or starred and in none. Removing the star takes it out of every list. |
| Who sees a list | Only its owner. |
| Your stars | `/explore/stars`: everything you starred, and each list, with the same cards as the grid. A list is a way back to things, whether or not you got them. |
| Publishing modes | Three, set by admins and moderators: **open** (published at once; the default), **reviewed** (each publication waits for approval), **off** (milestone 13). |
| Review | In reviewed mode a new listing, and each update of a listed one, is "waiting for review". An admin or moderator reads it on the same page members will see, with everything inside, and approves it or rejects it with a reason. |
| A rejected publication | Its publisher sees the reason on `/explore/mine`, changes what is needed and publishes again; that is a new submission, with the earlier reason kept beside it. |
| Updates under review | While an update waits, the listing stays up with the version approved before. A rejected update changes nothing on Explore. |
| Changing the mode | Going to reviewed mode leaves what is already listed as it is. Going back to open publishes nothing that is waiting; those are still approved or rejected one by one. |
| Who reviews what | Admins and moderators. Nobody reviews their own publication: an admin's or moderator's goes to the others; with nobody else to review, it is published and marked "not reviewed". |
| Reports | Any member can report a listing with a reason. Admins and moderators see reports with the review queue, and dismiss one or remove the listing (with a reason, as in milestone 13). A member reports a listing once. |
| Telling people | There are no notifications in the app. A publisher sees their listings' states on `/explore/mine`, and a count beside "Explore" in the sidebar when something of theirs was rejected or removed; reviewers see a count of what is waiting. |
| A removed or unlisted listing | Stays in the lists of those who starred it, shown as no longer available. |

## 2. What changes underneath

- **A version has a state.** In milestone 13 every version is published. Now `listingVersion.status` is `approved`, `pending` or `rejected`, and a listing shows its newest approved version. In open mode a version is approved as it is saved, so nothing else changes.
- **Counts.** `listing.stars` is kept with each star and unstar in the same transaction, as `gets` is, so sorting does not count rows.

## 3. Schema

| Table | Content |
|---|---|
| `star` | `userId`, `listingId`, `createdAt`; one per member and listing |
| `starList` | `id`, `userId`, `name`, `description`, `createdAt` |
| `starListItem` | `listId`, `listingId`, `createdAt`; a listing once per list |
| `listing` | adds `stars` |
| `listingVersion` | adds `status`, `reason`, `reviewedBy`, `reviewedAt` |
| `listingReport` | `id`, `listingId`, `userId`, `reason`, `status` (`open`, `dismissed`, `acted`), `resolvedBy`, `createdAt`; one open report per member and listing |
| settings | `explore.publishing` gains `reviewed` |

## 4. API

| Route | Purpose |
|---|---|
| `PUT /explore/listings/:id/star`, `DELETE …` | star, unstar |
| `GET /me/stars` | your starred listings and your lists |
| `POST /me/star-lists`, `PATCH /me/star-lists/:id`, `DELETE …` | lists |
| `PUT /me/star-lists/:id/listings/:listingId`, `DELETE …` | put in a list (stars it), take out |
| `GET /explore/reviews` | admins and moderators: what is waiting, and open reports |
| `POST /explore/versions/:id/review` | `{ approve }` or `{ reject, reason }` |
| `POST /explore/listings/:id/reports` | a member's report |
| `PATCH /explore/reports/:id` | dismiss, or mark acted on |
| `GET /explore/listings`, `GET /me/listings` | `sort=stars`; each listing's version states for its publisher |

## 5. Frontend

- A star button with the count on cards and on a listing's page; beside it "Add to a list…", with your lists as checkboxes and "New list".
- `/explore/stars`: "All stars" and one section per list; rename, describe and delete a list; take a listing out.
- `/explore/mine`: "Waiting for review", "Rejected: the reason" with "Publish again", "Removed: the reason".
- `/admin/explore`: the mode as three choices; a "Review" tab with what is waiting (opens the listing's page with Approve and Reject) and the open reports.
- A listing's page: "Report…".
- Counts beside "Explore" in the sidebar.

## 6. Phases

| # | Work | Done when |
|---|---|---|
| 14.1 | Stars and lists: the tables, the routes, the buttons and the list dialog, `/explore/stars`, the "most starred" sort | tests: a star counts once, a list item stars, unstarring empties the lists, another member's lists are not reachable; in Chromium: a listing added to "Productivity" shows one star, appears under that list and under "All stars", and "most starred" puts it first |
| 14.2 | Reviewed mode: version states, the queue, approve and reject with a reason, publishing again, updates that wait while the earlier version stays | tests for every transition (new listing and update, each mode, nobody reviewing their own, the last reviewer) and for what members see meanwhile; in Chromium with three accounts: a member's pack waits, is invisible to another member, is rejected with a reason the publisher reads, is published again and approved, and then appears |
| 14.3 | Reports, the sidebar counts, a smoke step | tests for reporting once, dismissing, and removal from a report; in Chromium: a report shows in the queue, the moderator removes the listing, and the publisher sees the reason and the count |

Built (14.1):
- Migration `0024_explore_stars`, the milestone's one, written whole now: `star`, `starList`, `starListItem`, `listing.stars`, `listingVersion.status` (`approved` by default, so every existing version stays published), `reason`, `reviewedBy`, `reviewedAt`, and `listingReport` with one open report per member and listing (a partial unique index). The setting's publishing mode (open, reviewed, off) is code, in 14.2.
- `server/utils/explore/stars.ts`: `starListing` and `unstarListing` keep `listing.stars` in the same transaction, once per member; unstarring takes the listing out of every list of the member's. Lists (`createList`, `changeList`, `deleteList`, `addToList` which stars, `removeFromList`) are the member's own, anyone else's not found. `myStars`: the starred listings newest first, and the lists in the order made, each with its listings.
- `browse.ts`: `listingCards`, the card the grid and the stars page share, from the member's side: the star count, whether they starred it, whether it is still shown on Explore. `sort=stars` ("Most starred": stars, then newest). A listing's page says whether the member starred it.
- Routes: `PUT` and `DELETE /explore/listings/:id/star`, `GET /me/stars`, `POST /me/star-lists`, `PATCH` and `DELETE /me/star-lists/:id`, `PUT` and `DELETE /me/star-lists/:id/listings/:listingId`. Starring and putting in a list need a listing the member can see; unstarring and taking out also work on one no longer shown.
- Screens: `ListingCard` (taken out of the grid, shared with the stars page) with a star button and its count, shown at once and back if the server refuses; "Add to a list…" on cards and on a listing's page: the member's lists as checkboxes, and new ones by name. `/explore/stars` ("Your stars" on Explore): "All stars", then each list with Rename…, Describe…, Delete and "Take out"; a listing removed or unlisted since stays, greyed, as "No longer available on Explore", keeping only its name and kind.
- Tests (`test/stars.test.ts`): a star counts once per member, unstarring twice too; putting in a list stars, in two lists still once; out of one list stays starred and in the other; unstarring empties every list and keeps the lists; deleting a list keeps its listings starred; another member's lists are not found for changing, deleting, adding or taking out, and stay out of their stars; "most starred" with each card's own star, and a removed listing in the stars as no longer available, without its summary or tags, still unstarrable.

Check in Chromium on the dev instance: two Characters published as the admin, "Alpha planner" first and "Beta writer" after. A member, on Alpha's card, chose "Add to a list…", made "Productivity" and saved: Alpha showed one star, its own. Beta added to "Productivity" too showed its star at once; unstarred again from its card, it left the list. On "Your stars", "All stars" and "Productivity" each held Alpha; with "Most starred", Alpha (1) came before the newer Beta (0). The listings, Characters and the member were deleted.

Built (14.2):
- The setting's publishing mode: `open`, `reviewed`, `off` (`PUBLISHING_MODES`); a value stored as a boolean before reads as `open` or `off`. `/admin/explore` offers the three as choices.
- Version states (`server/utils/explore/listings.ts`): a version starts `approved` in open and off mode; in reviewed mode `pending`, unless nobody but its publisher could review it (no other active admin or moderator), when it goes up approved with the note "Not reviewed: there was no other admin or moderator to review it." (`NOT_REVIEWED`). A listing's current version is its newest approved one: a new listing waiting has none, and is `published: false`. While a version waits, another update is refused (409). Publishing and updates say whether they wait.
- `exploreAbilities`: `readListing` hides a listing not yet approved from members, as an unlisted one; `review`: admins and moderators, never on their own publication ("Nobody reviews their own publication").
- `server/utils/explore/reviews.ts`: `pendingReviews` (oldest first, each a new listing or an update, with the publisher's note and the reason an earlier submission was rejected) and `reviewVersion` (approve: the version becomes current, a listing's first approval dating its publication; reject with a reason: Explore stays as it was; a version not waiting is refused, 409). Routes: `GET /explore/reviews`, `POST /explore/versions/:id/review` (`{ approve: true }` or `{ reject: true, reason }`).
- A listing's page: members see the current version and approved ones only; its publisher and admins and moderators see every version with its state, open any of them (`?version=`), and a reviewer reads a waiting one there with "Approve" and "Reject…" (the reason asked for). "Get" only once a version is on Explore. `myListings` carries every version's state for the publisher.
- Screens: the publish and update dialogs say publications are reviewed; the toast says "Sent for review". `/explore/mine`: "Waiting for review" (with what stays on Explore meanwhile, and "Rejected before:" the earlier reason), "Rejected: the reason" with "Publish again…", "not on Explore yet", "not reviewed". `/admin/review` ("Review" among the admin tabs, for admins and moderators): the queue, each opening the listing's page on its version, a reviewer's own marked "Yours: another reviews it".
- Tests: the ability table gained reviewed mode, a listing not yet approved, and reviewing (a moderator refused on their own); `test/review.test.ts`, against the database: open mode published at once; reviewed mode: a new listing waits unseen in the grid and refused to another member, read by a reviewer on its page as reviewable (not by its publisher), in the queue; approval puts it on Explore, dated anew; a rejection keeps it off with its reason, publishing again waits beside it, the queue showing both, and approval shows it; an update waits while version 1 stays for members, a second update is refused, a rejected one changes nothing, the next approved becomes current, and a decision on a version not waiting is refused; a moderator's publication waits for the admin and not for themselves; with the admin banned, the moderator's next goes up not reviewed, a member's still waits; back to open, what waits still waits; the boolean setting reads as a mode.

Check in Chromium with three accounts (the admin, a publisher and a viewer): the admin chose "Reviewed" on `/admin/explore`. The publisher published a group folder: the dialog said publications are reviewed, the toast "Sent for review", "Your listings" showed it waiting. The viewer did not find it on Explore, and its address answered 404. The admin opened it from "Review" on the listing's page ("Version 1 waits for review", Approve, Reject…) and rejected it: "Say in the summary what the team helps with." The publisher read "Rejected:" with the reason and "Publish again…", published again with a note, and saw version 2 waiting with "Rejected before:" and the reason; the queue showed the note and the earlier reason. The admin approved version 2, and the viewer found the pack on Explore, its page showing version 2 only. The mode was set back to open; the listing and both members were deleted.

Built (14.3):
- `server/utils/explore/reports.ts`: `reportListing` (a listing the member can see, with a reason; once while the report is open, by the partial unique index, 409; never their own, 400), `openReports` (oldest first, with the listing, its publisher and who reported it), `resolveReport` (dismiss: the listing stays; remove with a reason: the listing removed as in milestone 13, every open report of it settled as acted on; a settled report refused, 409), `exploreCounts` (`attention`: the member's listings removed or whose newest version was rejected; `waiting`, for admins and moderators: others' versions waiting and open reports). Routes: `POST /explore/listings/:id/reports` (10 in 10 minutes), `PATCH /explore/reports/:id` (`{ dismiss: true }` or `{ remove: true, reason }`), `GET /explore/reviews` now with `reports`, `GET /me/explore-counts`. Removing and settling are one call, not the plan's two.
- Screens: "Report…" on a listing's page for anyone but its publisher (the reason asked for; the toast says an admin or moderator will look at it). `/admin/review` gained "Reports": each with its listing, publisher, reporter and reason, "Dismiss" and "Remove…" (the reason, the report's own to start from). The sidebar shows `attention + waiting` beside "Explore"; the "Review" tab its `waiting`. Every Explore decision refreshes them (`['explore', …]` keys).
- Tests (`test/reports.test.ts`): reporting once while open, a second member too, the publisher refused; dismissing keeps the listing, settles the report (refused when decided again), and lets the member report again; removal from a report takes the listing off Explore with the reason its publisher reads and settles every open report of it; the counts for the publisher (rejected and removed), for reviewers (a report, a version waiting, not their own).
- Smoke step "review, stars and reports" (once, after the platforms; needs `SECOND_SESSION`): reviewed mode, the second member's Character waits and is approved from the queue, found, starred into a list, reported and removed from the report; the publisher reads the reason with a count. The mode, list, listing and Character are restored or deleted.

Check in Chromium with three accounts: a member published a Character; another reported it from its page ("Its instructions insult whoever asks.") and was refused a second report (409). The admin saw 1 beside "Explore" and on "Review", the report in the queue, and removed it with a reason; the queue read "No open reports" and the counts cleared. The publisher saw 1 beside "Explore" and "Removed by a moderator" with the reason on "Your listings"; it was gone from Explore. Deleting it cleared their count. Both members were deleted.

Live run (2026-11-26, both platforms with real keys, about $0.0073 in all): `scripts/app-smoke.ts` with the admin and a second member made for the run. Every step passed on OpenRouter and on DeepSeek, Explore's pack round answering "engineer", then "designer" on each. "Review, stars and reports": waited and approved, found by its word, starred into a list, reported and removed; the publisher read "A smoke run removes it." with 1 needing them. Images were skipped (no image model chosen), read-aloud on OpenRouter too (not set up there). The member was deleted; the setting is open.

## 7. Ceilings and things left out

- Lists are private: no public lists, no following someone's stars.
- No notifications by email or in a feed: states and counts on the page only.
- A review approves or rejects a whole publication; a reviewer cannot edit it.
- No automatic screening of content: review and reports are done by people.
- No appeal other than publishing again.
- Review covers what a listing holds (its versions), not its texts: a publisher changes the name, summary, description, tags and category of a listed listing without review. Reports (14.3) are the answer to a text that should not be there.
- "Publish again" makes a new version; texts a rejection asked about are changed with "Edit…", and are not part of the submission.
- One submission at a time: while a version waits, another update is refused, not queued.
