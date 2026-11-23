# Milestone 14: Explore's stars, star lists and moderation

Status: planned. Part of `roadmap-milestones-7-14.md`. One migration. Needs milestone 13.

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

## 7. Ceilings and things left out

- Lists are private: no public lists, no following someone's stars.
- No notifications by email or in a feed: states and counts on the page only.
- A review approves or rejects a whole publication; a reviewer cannot edit it.
- No automatic screening of content: review and reports are done by people.
- No appeal other than publishing again.
