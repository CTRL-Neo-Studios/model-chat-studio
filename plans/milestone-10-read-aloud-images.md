# Milestone 10: read-aloud and image generation

Status: spikes L and M done (2026-11-25); 10.1 next. Part of `roadmap-milestones-7-14.md`. No migration. Needs 7.3 for "speakers see images".

Goal: an answer can be listened to, and a chat can make images.

## 1. Decisions

| Topic | Decision |
|---|---|
| Read-aloud | A speaker button under each answer, for any signed-in member who can read the chat. It uses the active platform's text to speech. Whoever listens pays, as usage of a new kind, `tts`. |
| Speech on DeepSeek | `POST /v1/tools/tts`, voices Stella and Tide, WAV, with DeepSeek's own Markdown filter left on (spike L: it reads the app's plain text no worse). No model to choose. The response carries no cost: the app computes it from the price ($0.45 per 10,000 characters, a Chinese character counting as two), as it already does for DeepSeek's chat prices. |
| Speech on OpenRouter | `POST /api/v1/audio/speech` (MP3) with a speech model and a default voice the admin picks on the OpenRouter card. Off until a model is set. The response carries no cost, and no generation record appears for it (spike L): the app computes the cost from the model's catalog price per character, as for DeepSeek. |
| Voice | A member's preference per platform, from the voices that platform offers; otherwise the platform's default. |
| What is read | The answer's text without Markdown; code blocks, tables and charts are skipped; reasoning is not read. |
| Long answers | Cut at sentence ends: the first piece about 250 characters, so the first sound comes in about 3 to 4 s on DeepSeek; the rest about 600 characters. Pieces are fetched one after another (the next while one plays) and played in order. Stop cancels what is left. At most 20,000 characters of one answer. |
| Keeping audio | Not stored. Pieces already played stay in memory while the page is open, so listening again there is free; after a reload it is billed again. |
| Image generation | OpenRouter only (`POST /api/v1/images`), with the stored OpenRouter key (the member's own, else the instance's) whichever platform answers, as the decision model does. An image model the admin picks on the OpenRouter card; off until one is set. The response's `usage.cost` is recorded. Usage kind `image`. |
| Images by the model | A switch on the chat, "Images", beside web search. While on, a turn offers the model a tool, `generate_image`, and the model decides when to draw. |
| Images by command | `/image a red panda in space` draws from your words, with no model turn. |
| Where an image goes | Into storage as a file of the chat, and into the answer, shown inline with Download and "Add to library". |
| What models see | The model that drew gets "the image was made and shown". In later turns its own image stands in the thread as a line of text, "[image: the prompt]". A `/image` exchange is not sent to the models at all. In a group chat, another speaker whose model reads images gets the image itself (decided with milestone 7). |
| Limits | Budget checked before each piece of speech and each image. At most 4 images in one answer; 10 images and 60 pieces of speech a minute per member. |
| DeepSeek turns | The tool is an app tool like the chart. DeepSeek takes no app tools with web search on and thinking off (milestone 4), so there the switch says images are unavailable. |

## 2. What changes underneath

- **Adapters** gain `speak({ apiKey, text, voice, model })`, returning the audio and its cost, and lists: `listSpeechModels` with their voices, `listImageModels` (OpenRouter). Capabilities gain `speechModel` (a model must be chosen: OpenRouter) and `images`.
- **Settings**: `inference.openrouter.speechModel`, `speechVoice`, `imageModel`. Preference `voices` (a voice per platform). `chat.settings.images`.
- **One function makes an image** (`server/utils/chat/images.ts`): budget, the OpenRouter call, the file in storage, the usage row. The tool and the command both call it.
- **A generated image is a `file` row** of the chat, linked to its answer when the answer is saved. It is deleted with its message, as attachments are.
- **A `/image` exchange** is two messages: yours, and an answer that belongs to no lane, both marked `metadata.kind: 'image'`. The thread builders skip them.

## 3. API

| Route | Purpose |
|---|---|
| `POST /speech` | `{ text, voice? }` in, audio out, on the active platform. Text at most 1,000 characters a call. Rate-limited, budget-checked, recorded. |
| `GET /speech/voices` | the active platform's voices, with the member's and the default |
| `POST /chats/:id/images` | `{ prompt, aspectRatio? }`: the `/image` command; returns the two messages |
| `POST /chats/:id` (the turn) | offers `generate_image` when the chat's switch is on, an image model is set and an OpenRouter key is stored |
| `GET /admin/models?kind=speech\|images` | the pickers' lists |
| `PATCH /admin/settings`, `PATCH /me/preferences` | the new settings |

## 4. Frontend

- The answer's actions: "Read aloud", which becomes "Stop" while playing.
- `/settings`: a voice select per platform with "Play a sample".
- The prompt menu: "Images", beside web search, with why it is off when it is.
- `/image` among the "/" commands.
- Images in answers, with a tool card ("Drawing…", then the image; an error if it failed).
- `/admin/settings`, OpenRouter card: speech model and voice, image model, each a picker with prices.

## 5. Phases

| # | Work | Done when |
|---|---|---|
| 10.P | Spikes L and M, below | each is confirmed or the plan changes |
| 10.1 | Speech on the server: `speak` on both adapters, the route, the voices route, the settings and their pickers, the usage kind | tests for cutting text into pieces, stripping Markdown, and DeepSeek's cost (Chinese counted twice); against fixture platforms the route returns audio on each and records a `tts` row; over budget answers 402 |
| 10.2 | Read-aloud on screen: the button, playing pieces in order, stop, the voice preference | in Chromium against a fixture: a three-piece answer plays to the end in order; Stop ends it and no further piece is requested; the chosen voice is the one sent |
| 10.3 | Images by the model: the setting and picker, the function that makes an image, the tool, the chat's switch, images in answers | tests for the limits and for what later turns carry in place of an image; fixture: with the switch on, a tool call makes an image that shows in the answer and is stored as the chat's file; with DeepSeek active the image request goes to OpenRouter and the answer to DeepSeek |
| 10.4 | `/image`, group speakers seeing images, smoke steps, the live run | fixture: `/image` adds its two messages and the next turn's request holds neither; a second speaker with a vision model receives the first one's image. Live on both platforms: an answer read aloud in each platform's voice, an image drawn by a model's tool call and by `/image` |

## 6. To verify before building

- **Spike L, speech.** On both platforms: the time to the first sound for a 300-character piece; whether Chromium, Safari and Firefox play what comes back (`audio/wav` from DeepSeek, MP3 from OpenRouter) from a fetched blob; how OpenRouter reports the cost of a speech call (the body is audio: a header, or a lookup by generation id?); the shape of its speech models list and where the voices are; whether DeepSeek's own Markdown filter can stay on next to the app's.
- **Spike M, images.** The request and response of `POST /api/v1/images` with the cheapest image model: size of the result, `usage.cost`, time taken, aspect ratios. A function tool that makes an image, on a DeepSeek turn and on an OpenRouter turn, next to web search: does the model call it, and does it write sensibly after "the image was made"? Whether a later turn accepts the assistant's own earlier image as a file part, or only the text line planned above.

Result L (2026-11-25, `model-chat-studio-prep/scripts/spikes/m10/speech.ts`, instance keys; `keys.ts` opens them from the dev database):
- **DeepSeek** answers a 299-character piece as `audio/wav` (24 kHz mono, about 850 KB for about 18 s): the first byte after 1.3 to 1.4 s, the whole piece after 3.7 to 4.4 s (Stella and Tide alike). No cost in the headers; Chinese is billed at two characters each, as documented.
- **DeepSeek's Markdown filter can stay on.** Plain text with Markdown-looking characters (`snake_case_names`, `__init__.py`, `2 * 3`, `#3`, `$5`, `[the guide]`), read back with DeepSeek's ASR, came out no worse with `filter_markdown` on than off (off read `snake_case_names` as "snakey guide dollars").
- **OpenRouter** has 38 speech models at `GET /audio/speech/models`, public. The voices are under `output_modalities[type=speech].supported_parameters.voice.values` (some models publish none), the formats under `response_format`. Prices are in `GET /models?output_modalities=speech`, `pricing.prompt` per character. The cheapest with voices and MP3 is `hexgrad/kokoro-82m` at $0.99 per million characters, 54 voices. A 299-character piece came back as `audio/mpeg`, 130 KB, the first byte after 0.35 s, the whole after 1.1 s.
- **OpenRouter reports no cost for speech.** The response's only header of use is `X-Generation-Id`; `GET /generation?id=` answered 404 for it for over a minute, and the key's `usage` had not moved 30 s after a 1,000-character call. So the cost is computed from the catalog price (decision table above).
- **Playback from a fetched blob** works in Chromium and in WebKit (Safari's engine) for both formats: `canPlayType` says yes, metadata loads, `play()` starts, `decodeAudioData` decodes. WebKit's `<audio>` misreads the MP3's length (2.92 s for 18.7 s) and its position, yet plays it to the end; progress should not come from `<audio>` timing. Firefox is not installed here and was not tried.
- **Decided after L (you, 2026-11-25):** the first piece of an answer is about 250 characters, the rest about 600.

Result M (2026-11-25, `images.ts`, `own-image.ts`, `other-speaker-image.ts`):
- **`POST /api/v1/images`** with `recraft/recraft-v4.1-flash-v2` (the cheapest paid image model of 71 at `GET /images/models`, $0.007 an image, priced per endpoint at `…/endpoints`; a `:free` variant exists) answers `{ created, data: [{ b64_json, media_type }], usage }`. The image is WebP, 0.7 to 1.5 MB, 1.3 to 2.2 s; `usage.cost` is 0.007. Without `aspect_ratio` the model picks a size (832×1280, 1024×1024, 896×1152); `16:9` gave 1344×768. The model lists 12 aspect ratios.
- **The tool is called, and only when asked.** `generate_image` was called on DeepSeek with web search off and thinking off, and with web search on and thinking on, and on OpenRouter (DeepSeek V4.1 Flash) with web search on. Each time it got a detailed prompt and, after "The image was made and shown to the user", wrote one sensible line about the picture and offered other styles. Asked the capital of Portugal, no model drew. (DeepSeek with web search on and thinking off takes no app tools: milestone 4.)
- **A model does not see its own earlier image.** Given back as a file part of its own answer, the request is accepted on both platforms, but DeepSeek described a fox asleep in the snow as "a cat sitting and smiling", and OpenRouter answered that it could not view it. With only a neutral text line they guessed or said they could not see it. So later turns carry "[image: the prompt]", as planned.
- **Another speaker's image, in a user message as a group passes it on, is seen** on both platforms ("A fox sleeping in snow."), so 10.4's plan holds.

## 7. Ceilings and things left out

- No true streaming of speech: it comes in pieces.
- One voice per member and platform; Characters have no voices of their own.
- No editing of an image, no image made from another image, no models that write images straight into their answer.
- A model does not see its own earlier images, only their prompts.
- Speech and images are not offered to guests reading by link: there is nobody to bill.
- No video.
