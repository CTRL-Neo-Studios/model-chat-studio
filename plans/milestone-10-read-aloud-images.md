# Milestone 10: read-aloud and image generation

Status: complete (2026-11-25): spikes L and M, 10.1 to 10.4, and the live run on both platforms. Part of `roadmap-milestones-7-14.md`. No migration. Needs 7.3 for "speakers see images".

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
| What models see | The model that drew gets "the image was made and shown". In later turns its own images stand in the thread as a line of text each, "[image: the prompt]"; for a model that reads images, the latest one is also shown again, in a user message after that answer: "The picture you drew in your last answer, shown again so you can see it". A `/image` exchange is not sent to the models at all. In a group chat, another speaker whose model reads images gets the image itself (decided with milestone 7). |
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
| 10.3 | Images by the model: the setting and picker, the function that makes an image, the tool, the chat's switch, images in answers | tests for the limits and for what later turns carry in place of an image (the text line, and the latest image shown again to a model that reads images); fixture: with the switch on, a tool call makes an image that shows in the answer and is stored as the chat's file; with DeepSeek active the image request goes to OpenRouter and the answer to DeepSeek |
| 10.4 | `/image`, group speakers seeing images, smoke steps, the live run | fixture: `/image` adds its two messages and the next turn's request holds neither; a second speaker with a vision model receives the first one's image. Live on both platforms: an answer read aloud in each platform's voice, an image drawn by a model's tool call and by `/image` |

Built (10.1): `shared/utils/speech.ts` holds `plainForSpeech`, `speechText` and `speechPieces`, for 10.2's player and the server's limits:
- `plainForSpeech` leaves out fenced code (one left open at the end too), table rows and their separator lines, images, bare and angle-bracket URLs and HTML tags. Links are read as their text. Heading, quote, list and rule marks and emphasis come off; inline code is kept aside meanwhile, so `__init__.py` keeps its underscores, and underscores inside words stay.
- `speechText` reads an answer's text parts only (not reasoning, tools or files), at most `SPEECH_ANSWER_MAX` (20,000 characters).
- `speechPieces` cuts at sentence ends (`Intl.Segmenter`, so Chinese too): the first piece about 250 characters, the rest about 600, a sentence kept whole up to `SPEECH_PIECE_MAX` (1,000) and longer ones cut at a space or comma, else at the limit.

The platforms: `InferencePlatform` gains `speak`, `capabilities.speechModel`, `listSpeechModels` (OpenRouter) and `voices` (DeepSeek: Stella, the default, and Tide); `CatalogModel` gains `pricePerMillionChars` and `voices`.
- DeepSeek's `speak` asks `/v1/tools/tts` for WAV, its Markdown filter on; the cost is `deepseekSpeechCost`, $0.45 per 10,000 characters at list price, a Han character counting as two.
- OpenRouter's `listSpeechModels` joins `/audio/speech/models` (voices, formats) with `/models?output_modalities=speech` (price per character), keeping models that publish voices and return MP3 (26 today). Its `speak` asks `/audio/speech` for MP3; the cost is the catalog price times the characters.
- `speechSetup` (`server/utils/inference`) gives the active platform's voices, default voice, and the speech model with its price, or `null` until set up.
- The settings gain `speechModel` and `speechVoice` (OpenRouter), the preferences `voices` (one per platform; `PATCH /me/preferences` merges them, `null` clears one), and usage the kind `tts`.

Routes:
- `POST /speech` (`{ text, voice? }`) takes one piece of at most 1,000 characters, 60 a minute. It refuses with 503 until set up and checks the budget before the call (402). The voice is the one asked for if the platform offers it, else the member's, else the default. It answers the audio with `X-Voice` and `Cache-Control: no-store`, and records a `tts` row with the cost.
- `GET /speech/voices` answers `{ available, platform, voices, defaultVoice, voice }`.
- `GET /admin/models?kind=speech` lists the speech models.
- The OpenRouter card on `/admin/settings` has "Text-to-speech model" (the model browser shows "Price per 1M characters", and "Cheapest first" sorts by it) and "Default voice", a select of that model's voices.

Tests: Markdown made plain (code, tables, links, emphasis, an open fence), an answer's parts, the pieces (sizes, sentence ends, a long sentence, Chinese, text without spaces), DeepSeek's price.

Fixture check (a throwaway plugin answering both speech calls; lists and prices real):
- DeepSeek: `GET /speech/voices` gave Stella and Tide, Stella the default. A piece came back as `audio/wav` read by Stella, the request `{ text, voice_id: 'stella', format: 'wav' }`. Asked for Tide it was Tide; asked for a voice DeepSeek lacks, Stella. After choosing Tide in the preferences, Tide unasked.
- OpenRouter without a speech model: 503 "Read-aloud is not set up yet". With Kokoro and `af_bella` set: 54 voices, `af_bella` the default, `audio/mpeg`, the request `{ model: 'hexgrad/kokoro-82m', input, voice: 'af_bella', response_format: 'mp3' }`.
- A piece of 1,001 characters: 400.
- Usage: one `tts` row per piece, DeepSeek's at $0.002205 for 45 characters with 4 Chinese, OpenRouter's at $0.00004455 (45 × $0.99 per million).
- With a budget of $0: 402, and no call reached the platform.
- Chromium: the OpenRouter card showed the new field and, once a model was picked, the voice select with that model's voices.
- The settings, the preference and the fixture's usage rows were put back.

Built (10.2): `useReadAloud` (`app/composables/useReadAloud.ts`) reads one answer at a time in the whole app:
- It makes the answer's text plain and cuts it into pieces (`speechText`, `speechPieces`), then fetches each from `POST /speech` with the member's voice (or the default) and plays them in order on one shared audio element. The next piece is fetched while one plays.
- Starting another answer, or Stop, aborts what is in flight and requests nothing more. An error shows as a toast.
- The audio element is started on the click with a WAV of no samples, so Safari lets it play the pieces that arrive later. This was not tried in Safari.
- Pieces stay in memory by platform, voice and text while the page is open, so listening again is free; a reload forgets them.

`ChatReadAloud` is the button under an answer: "Read aloud" (a speaker), "Stop" (a square) while it reads, pulsing while it waits for a piece. It shows only once read-aloud is set up (`speechVoicesQuery`). The answer's actions row now shows for any signed-in member who reads the chat, with only this button for those who do not own it; guests reading by link see none.

`/settings` has a "Read aloud" card: a select of the active platform's voices ("(default)" marked), saved at once to `voices` for that platform, and "Play a sample", which reads one sentence in the chosen voice. Each platform keeps its own choice, but the card shows only the active one's voices; another platform's are not listed.

Fixture check in Chromium. A throwaway plugin answered DeepSeek chat with a fixed 1,123-character answer and DeepSeek TTS with a 1.5 s tone after 0.4 s, recording each request. The page's `play()` was watched only to log what played.
- Read to the end: the answer was read in 3 pieces (250, 528 and 343 characters), requested in order in Stella, the default. Each played and ended, the next starting as the previous ended, about 1.6 s apart. The button showed Stop while reading and Read aloud after.
- The voice: Tide chosen in the settings' select ("Saved"). "Play a sample" sent its sentence in Tide.
- Stop: on the chat again (the page reloaded, so nothing was in memory), Stop was pressed half a second into the first piece. Pieces 1 and 2 had been requested, both in Tide, the second while the first played. Five seconds later nothing more had been requested or played, and the button read Read aloud again.
- The preference, the chat and the fixture's usage rows were put back.

Built (10.3): the admin picks an "Image model" on the OpenRouter card (`imageModel`, `GET /admin/models?kind=images`). OpenRouter's image models list has no prices, so `listImageModels` reads each model's endpoints, 8 at a time, and keeps the cheapest per-image (or per-megapixel) price; the picker's column is "Price per image". 44 of the 71 models had one; the rest are priced per output token and show "Unknown".
- `server/utils/chat/images.ts`: `imageSetup` finds the image model and the stored OpenRouter key (the member's own, else the instance's); `makeImage` checks the budget on the instance key, calls `POST /images` (`openrouterImage` in the adapter), stores the image as a file of the chat and writes a usage row of kind `image` with the cost the response reports.
- `server/utils/chat/imageTool.ts`: the `generate_image` tool (a prompt, an optional aspect ratio) and its limits, at most 4 images in an answer and 10 a minute per member; the model is told only "The image was made and shown to the user." `imagesForModel` makes what later turns carry: each drawn image becomes "[image: the prompt]", a failed call is left out, and a model that reads images gets the latest one again in a user message right after the answer that drew it.
- The answer route offers the tool when the chat's `images` setting is on, an image model and key exist, the model takes tools and app tools are allowed (not with DeepSeek web search and thinking off). The answer's images are linked to it when it is saved (`file.messageId`), so they go with it; if it is not saved they are deleted.
- `GET /models` says whether images are available and why not. The prompt menu has an "Images" switch with that reason, or, on DeepSeek with web search on, that drawing needs thinking on.
- `ChatToolImage` shows "Drawing: the prompt", then the image with Download and, with the chat's editable libraries (provided by `ChatView`), "Add to library"; a failure shows as an error card.

Fixture check, DeepSeek active, the chat on `deepseek-flash` (reads images). A throwaway plugin answered DeepSeek chat with a `generate_image` call and then text, and OpenRouter images with a 256-pixel PNG costing $0.007, recording each request.
- The image request went to OpenRouter (`recraft/recraft-v4.1-flash-v2`, the prompt and `aspect_ratio: 1:1`), the answers to DeepSeek. The image was stored as a file of the chat, linked to the answer, served inline; the usage row was `image` on OpenRouter at $0.007.
- The next turn sent DeepSeek "[image: a gradient square]" in place of the tool call, then the user message "The picture you drew in your last answer, shown again so you can see it:" with the image as a data URL, then the new question.
- In Chromium the image showed in the answer with Download. With a library attached, "Add to library" copied it there. The prompt menu's "Images" switch was on, saved off to the chat, and with web search on said DeepSeek draws only while thinking is on.
- Deleting the chat deleted the image file (404). The setting, the chat, the library and the fixture's usage rows were put back.

Built (10.4): `/image the words` draws with no model turn (`POST /chats/:id/images`, `{ prompt, aspectRatio? }`).
- The route checks the setup and the 10-a-minute limit, then calls `makeImage`. `saveImageExchange` (`turns.ts`) saves two messages at the tip, both marked `kind: 'image'`: the user's "/image the words", which becomes the tip, and an answer of no lane, labelled "Image", holding the image as a finished `generate_image` call that the image card shows. The image file is linked to that answer. If saving fails, the image is deleted.
- Models are not sent the exchange. `withoutImageExchanges` (`thread.ts`) removes it after the branch is found, so the next message, whose parent is the `/image` message, still reads the whole branch. This applies to the turn route and `/compact`. A turn asked to answer a `/image` message gets 400. A group's "Answer" picks the last message that is not one.
- The "/" menu offers `image` while images are set up. Picking it leaves "/image " in the prompt; sending "/image …" draws instead of starting a turn, with the prompt shown as busy meanwhile.
- Group speakers see images: `groupThread` gives another speaker's image as "[image: the prompt]" in its text, and to a speaker whose model reads images (`seesImages`) also as the image itself, a file after the text.
- Read-aloud is hidden on answers with nothing to read (only an image or a chart).
- `scripts/app-smoke.ts` gained "read aloud" (one piece in the platform's default voice) and "images" (one by the model's tool call, one by `/image`, both stored and served as images). Each is skipped while its setup is missing.

Fixture check (DeepSeek answering, OpenRouter images faked):
- `/image a lighthouse at dusk` saved both messages (the answer with no lane, kind `image`). Answering that message was refused with 400. The next turn sent DeepSeek only "Hello.", its answer and "What now?": no "/image", no image. Its parent was the `/image` message.
- In a group, the Painter drew with the tool. The Critic, on `deepseek-flash`, which reads images, then received "Painter: [image: a gradient fox] …" with the image as an `image_url`.
- In Chromium, typing "/ima" and Enter left "/image " in the prompt; "a sailboat on a lake" and Enter drew it, and the exchange showed with the image card. The read-aloud button showed on both "Noted." answers and not on the image.
- The chats, the setting and the fixture's usage rows were put back.

Live run (`scripts/app-smoke.ts`, 2026-11-25), with the OpenRouter speech model set to the cheapest, `hexgrad/kokoro-82m` (voice af_alloy), and the image model to `recraft/recraft-v4.1-flash-v2`, both unset again afterwards. Every step passed on both platforms:
- OpenRouter (`deepseek/deepseek-v4.1-flash-1017`): read aloud gave `audio/mpeg`, 27 KB in af_alloy. The model drew with the tool and `/image` drew, both stored as `image/webp`. $0.0166 for the run.
- DeepSeek (`deepseek-flash`): read aloud gave `audio/wav`, 150 KB in Stella. Images were drawn on OpenRouter by the tool and by `/image`, both `image/webp`. $0.0185 for the run.

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
- **A model does not see its own earlier image where it stands.** Given back as a file part of its own answer, the request is accepted on both platforms, but the image is dropped: DeepSeek described a fox asleep in the snow as "a cat sitting and smiling", and in a rerun both answered that no image had been drawn. With only a neutral text line they guessed ("a red fox sitting") or said they could not see it.
- **Shown again in a user message it is seen** on both platforms: labelled "The picture you drew in your last answer, shown again so you can see it", DeepSeek said "A red fox sleeping in snow." and OpenRouter "A red fox, curled up sleeping." (`own-image.ts`).
- **An image in the tool's result is not sent as an image.** With `toModelOutput` returning a media part, both platforms got it as base64 text: 1.5 million tokens for one 1.6 MB WebP, over the context limit. Tool results stay text.
- **Decided after M (you, 2026-11-25):** later turns carry "[image: the prompt]" for every image; a model that reads images is also shown the latest one again in a user message (decision table above). Each such turn pays for that image's input again.
- **Another speaker's image, in a user message as a group passes it on, is seen** on both platforms ("A fox sleeping in snow."), so 10.4's plan holds.

## 7. Ceilings and things left out

- No true streaming of speech: it comes in pieces.
- One voice per member and platform; Characters have no voices of their own. The settings list only the active platform's voices.
- Read-aloud is not checked in Safari or on phones here; its unlocking of audio on the click is the usual way, untried.
- No editing of an image, no image made from another image, no models that write images straight into their answer.
- Image models priced per output token show no price in the picker; their real cost still comes from the response.
- Speech and images are not offered to guests reading by link: there is nobody to bill.
- No video.
