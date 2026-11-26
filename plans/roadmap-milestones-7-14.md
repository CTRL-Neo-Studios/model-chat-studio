# Roadmap: milestones 7 to 14

Status: milestones 7, 8, 9, 10, 11 and 12 complete with their live runs (7 and 8 on 2026-11-23, 9, 10 and 11 on 2026-11-25, 12 on 2026-11-26); milestone 13's spike O and 13.1 done (2026-11-26), 13.2 next. Eight milestones, each with its own plan file. The conventions of milestone 1 (section 2 there) and the way of working so far apply unchanged: spikes first where a plan lists them, one phase per step, a check against a fixture platform for each phase, a live run at the end of each milestone.

## Order

| # | Milestone | Plan | Needs | Phases |
|---|---|---|---|---|
| 7 | Folders with a page and fuller defaults; group speakers see each other's charts | `milestone-7-folders.md` | — | 3 |
| 8 | Branching: versions of an answer, branches of the conversation | `milestone-8-branching.md` | — | spike + 3 |
| 9 | Character cards: avatar, greetings, examples, lorebooks with their options, import and export | `milestone-9-character-cards.md` | 8.1 (versions, for alternate greetings) | spikes + 5 |
| 10 | Read-aloud and image generation | `milestone-10-read-aloud-images.md` | 7.3 for "speakers see images" | spikes + 4 |
| 11 | Edit access for people a chat is shared with | `milestone-11-shared-editing.md` | 8.2 (the chat's tip) | 3 |
| 12 | Export and import of chats | `milestone-12-export-import.md` | 8 to 11, so the file covers branches, versions, images and authors | spike + 4 |
| 13 | Explore: publishing and getting Characters, libraries, structure profiles and packs | `milestone-13-explore.md` | 7.1 (folder defaults as a pack's setup), 9 (what a Character holds) | spike + 4 |
| 14 | Explore: stars, star lists, review before publishing, reports | `milestone-14-explore-stars-review.md` | 13 | 3 |

Why this order: folders are small and change nothing underneath. Branching changes how messages are stored, so it comes before everything that reads or writes them. Cards reuse answer versions for alternate greetings. Export comes after 8 to 11 so its file format is written once. Explore copies Characters, libraries and folder setups between members, so it waits for milestone 9 to finish what a Character is; it needs nothing of 10 to 12 and can move up to right after 9.

## Decided (your answers, 2026-11-22)

| Topic | Decision |
|---|---|
| Folders | A folder may also carry the models, the mode, who you are and the chat settings, and gets a page. By default a folder still only organises chats: defaults are optional and a folder without them behaves as today. |
| Group chat leftovers | Speakers also see the others' charts and generated images. Switching a chat between group and separate answers stays out. |
| Regenerate | Keeps the earlier answers as versions; later messages stay, and nothing after the answer is sent to the model. That is what OpenRouter's Chatroom does on retry (you, 2026-11-22), so Regenerate keeps its name and there is no second button. Editing with "Save and resend" starts a branch. |
| Edit access | The sender pays: their own key, else the instance key against their budget. |
| Images | A switch on the chat (the model decides when to draw), plus a `/image` command. Through the stored OpenRouter key whichever platform answers. |
| Explore (you, 2026-11-22) | A place on the instance to publish and get Characters, libraries, structure profiles and whole setups, without money, after nuxt.com/modules. Stars and named star lists as on GitHub; saving to a list stars. Admins and moderators control it: open by default, or reviewed (each publication approved, or rejected with a reason and published again), or off. |

## What the platforms offer (docs read 2026-11-22)

| | OpenRouter | DeepSeek |
|---|---|---|
| Text to speech | `POST /api/v1/audio/speech` (`model`, `input`, `voice`, `response_format` mp3 or pcm); a list of speech models with their voices | `POST /v1/tools/tts` (`text`, `voice_id` stella or tide, wav or pcm), at most 10,000 billed characters a request, $0.45 per 10,000 characters at list price, no cost in the response |
| Image generation | `POST /api/v1/images` (`model`, `prompt`; the image as base64, `usage.cost`), a list of image models; also a server tool, `openrouter:image_generation`, documented for the Responses API | none |

Everything else about them is in the spikes of milestone 10.

## Asked of you, when the milestone starts

1. **The OpenRouter chat export sample** (milestone 12, before spike N).
2. ~~**Character cards to test with** (milestone 9, before spike J)~~: received 2026-11-23, "Ignathius (UT)" as JSON and PNG in `scripts/testdata/`; spike J also used SillyTavern's default "Seraphina".

## Across milestones

- Migrations: two for milestone 8 (versions in 8.1, the tree in 8.2), two for 9 (the Character in 9.1, lorebooks in 9.4), one each for 11, 13 and 14, numbered from `0018` in the order they are built. Milestones 7, 10 and 12 need none.
- New usage kinds: `tts`, `image` (10). Usage is always recorded for whoever made the call.
- `scripts/app-smoke.ts` gains a step per milestone, so each one stays checkable live.
