# Milestone 18: a rich prompt, long pastes, a full-screen prompt, notes in Markdown

Status: milestone 18 built (2026-11-27): 18.1 to 18.4. Follows `milestones-15-17-navigation-content-packages.md`. No migration: the one new preference lives in `user.preferences` (jsonb).

Goal: the prompt bar writes rich text and sends Markdown, and the chat shows a member's messages formatted; a long paste asks whether it goes in as text or as a text attachment; the prompt can fill the panel; a library note can be edited as raw Markdown, takes pasted Markdown formatted, and is renamed from its title.

## 1. Decisions (asked 2026-11-27)

- Pasted plain text in a rich editor (a note, the prompt in rich mode) is parsed as Markdown. Text copied from VS Code counts as plain (it carries `vscode-editor-data` beside its HTML). Raw mode stays for exact text.
- The prompt starts in rich mode; the choice (rich or raw) is remembered per browser (a cookie, so the server renders the same editor).

## 2. What changes

| Where | Change |
| --- | --- |
| Prompt bar | Two modes, toggled by icon buttons in its footer. **Rich**: the starter kit (headings, lists, quotes, code, bold, italic, strike), Markdown shortcuts, a bubble toolbar on a selection; it sends the editor's Markdown. **Raw**: today's plain editor; it sends exactly what was typed. "/" and "@" work in both. Enter sends; in a list or a code block Enter is the editor's, and Mod+Enter sends. |
| A member's messages | Rendered as Markdown (`ChatComark`) with single line breaks kept (comark's `breaks` plugin), so raw text and earlier messages keep their lines. Editing a message stays a plain textarea of its Markdown. |
| Long pastes | Pasting more than the member's limit (Settings › Chat, "Long pastes", default 2,000 characters; 0 never asks) opens a dialog: "Paste as text" or "Attach as a file" (a `.txt` attachment, uploaded like any other). |
| Full screen | A button in the prompt's footer makes it fill the panel below its navbar; again, or sending, puts it back. |
| Library notes | "Rich text / Raw" in the note's header: raw is a textarea of the note's Markdown. Pasted Markdown comes out formatted in rich mode. Double-clicking the title renames the note in place: Enter (or leaving the field) saves, Esc puts the name back. |

## 3. How

- `app/utils/editor.ts`: `MarkdownPaste` (a ProseMirror paste handler: plain text in, `insertContent(text, { contentType: 'markdown' })`, not inside a code block) and `MarkdownMention` (Tiptap's Mention with `renderMarkdown`, `@label`; the built-in one has none, so a mention vanished from Markdown output).
- Prompt (`chat/Prompt.vue`): `UEditor` keyed by the mode; rich adds `content-type="markdown"`, the starter kit, `MarkdownPaste`, `MarkdownMention` (`:mention="false"`) and a bubble `UEditorToolbar` appended to the page (the editor scrolls). The model is the editor's Markdown in rich mode, its text in raw mode; text set from outside goes back in as Markdown or as lines.
- The long-paste check is a paste handler of the prompt's own extension (priority over `MarkdownPaste`): plain text over the limit, no files, opens `ModalLongPaste`; "as text" inserts it as a paste would (Markdown in rich mode), "as a file" adds `new File([text], 'Pasted text N.txt', { type: 'text/plain' })` to `v-model:files`.
- Preference `longPaste` (`shared/utils/preferences.ts`, `PATCH /me/preferences`), its card on Settings › Chat.
- Full screen: the prompt finds its `UDashboardPanel` (`[id*="-panel-"]`), measures it (`useElementBounding`) and is `fixed` over it from `--ui-header-height` down, opaque; the editor grows to fill it.
- Notes (`library/Entry.vue`): the mode in a cookie; the rename `PATCH`es `name` like the tree's "Rename", the tree's copy changed at once and put back if refused.

## 4. Phases

| Phase | Builds | Done when |
| --- | --- | --- |
| 18.1 | Prompt rich/raw, bubble toolbar, Markdown mentions and pastes; messages as Markdown | In Chromium: a bold word and a list typed in rich mode arrive as `**bold**` and `- item` and show formatted; an "@" mention survives; raw mode sends `<div>` as typed; a raw message with two lines shows two lines |
| 18.2 | Long pastes and the preference | In Chromium: a paste over the limit asks; "as text" fills the prompt, "as a file" adds a `.txt` attachment that uploads; a limit of 0 never asks |
| 18.3 | Full-screen prompt | In Chromium: the prompt fills the panel under the navbar, the editor grows; the button or sending puts it back |
| 18.4 | Notes: raw mode, Markdown paste, rename from the title | In Chromium: raw shows the Markdown and edits save; pasted Markdown comes out formatted; double-click, type, Enter renames (the tree follows), Esc puts it back |

Built (18.1):
- `app/utils/editor.ts`: `MarkdownPaste` and `MarkdownMention`. The prompt (`chat/Prompt.vue`): the mode in the `prompt-mode` cookie, two icon buttons beside the send button ("Rich text", "Raw: sent exactly as typed"), the editor keyed by the mode; rich adds the starter kit, `content-type="markdown"`, both extensions and a bubble toolbar (bold, italic, strike, code; lists, quote, code block) appended to the page. Rich sends `getMarkdown()` without its trailing blank lines; raw sends `getText`. Keys: Enter sends, except in a rich list or code block; Mod+Enter sends; in rich mode Shift+Enter starts a paragraph (a line break inside one would keep "- " or "# " from formatting the next line), in raw mode it breaks the line. A member's message renders with `ChatComark` and comark's `breaks` plugin.
- Found on the way: asking `isActive('listItem')` of raw mode's schema, which has no lists, read as true and stopped Enter from sending; the check is rich-only.

Check in Chromium (admin, a chat answered by two DeepSeek models): typed in rich mode, "Reply with the single word **pong**, nothing else", Shift+Enter, "- first", Enter, "second" was stored as `…**pong**, nothing else\n\n- first\n- second` and shown with a bold word and a list; a mention node came out as `Read @notes.md please`; "# Title / - a / - **b**" pasted as plain text became a heading and a list; the bubble toolbar opened on a selection. In raw mode `Reply <div>ok</div> with **one** word` stayed as typed; a raw message of two lines with `<b>bold</b>` was stored as typed and shown on two lines, "bold" in bold; raw was still chosen after a reload; Enter sent in both modes.

Built (18.2):
- Preference `longPaste` (default 2,000, 0 never asks; `shared/utils/preferences.ts`, `PATCH /me/preferences`), the "Long pastes" card on Settings › Chat (`UInputNumber`, saved on Enter or leaving it). `ModalLongPaste` (the size, the first 1,200 characters, "Paste as text", "Attach as a file", "Cancel"). The prompt's extension has the paste handler, ahead of `MarkdownPaste`: plain text past the limit, no files, asks; "as text" pastes as the paste would have (HTML as HTML, Markdown in rich mode, lines in raw), "as a file" adds `Pasted text N.txt` (`text/plain`) to the prompt's files, which upload as any.

Check in Chromium: a 2,601-character paste opened "Paste 2,601 characters" with its start; "Paste as text" made a heading and a list; again, "Attach as a file" added "Pasted text 1.txt" (TXT · 3KB), which uploaded and was removed again; the card took 1,500 with Enter and 0 on leaving the field ("Saved"); at 0 a 3,011-character paste went in without asking; the limit was put back to 2,000 and the test chat deleted.

Built (18.3):
- `chat/Prompt.vue`: a "Full screen" / "Exit full screen" button before the mode buttons; it focuses the editor. The prompt finds its `UDashboardPanel` from the editor's node (`[id*="-panel-"]`), measures it with `useElementBounding` and is `fixed` from `--ui-header-height` below its top to its bottom, opaque (`bg-default`), the editor growing to fill it (`flex-1`, no `max-h-60`). Sending ends it. The position is on a wrapper `div` (`display: contents` otherwise), and the page's class goes on to `UChatPrompt` (`inheritAttrs: false`, `v-bind="$attrs"`): `UChatPrompt` passes a `style` to its own textarea, which the editor replaces, so a style on it went nowhere.

Check in Chromium (admin): on the new-chat page the prompt (704 × 100) became 964 × 764 at the panel's left edge, from the navbar's bottom (y 80) to the panel's (y 844), the editor 712 px tall and focused; at a 1000 × 700 window it followed (968 × 604); the button put it back as it was. Typed in full screen, Enter sent and the chat page opened with the prompt back to its size; there, under the navbar laid over the messages, full screen covered the panel the same way. The test chat was deleted.

Built (18.4):
- `library/Entry.vue`: "Rich text" and "Raw Markdown" icon buttons beside the note's "Saved" (the mode in the `note-mode` cookie); raw is a `UTextarea` of the note's Markdown (monospace, read-only for viewers), saved like the editor's text; the rich editor has `MarkdownPaste`. The title renames in place on a double-click (a `UInput`, "Double-click to rename" as its hint): Enter or leaving the field saves, Esc puts the name back; like the tree's "Rename", the tree's copy changes at once and comes back if refused, and the entries are read again after, so the tree takes its order.

Check in Chromium (admin, a throwaway library "Check 18.4" with the notes "Plan" and "Alpha"): "Plan" opened as a heading, a list and a paragraph; "Raw Markdown" showed `# Plan\n\n- one\n- **two**`, text typed there was saved (`Added in **raw**.`) and showed bold back in "Rich text"; "## Pasted / 1. first / 2. second" pasted as plain text became a heading and a numbered list and was saved as that Markdown. A double-click on the title opened the field on "Plan", focused; "Zeta plan" with Enter was stored, the title and the tree followed (Alpha, Zeta plan); "Nope" with Esc put "Zeta plan" back and stored nothing; "Plan B" saved on leaving the field. The library was deleted.

## 5. Ceilings

- Rich mode sends Tiptap's Markdown, which escapes what is typed literally (`*` → `\*`, `<` → `&lt;`): the chat shows it right, the model reads it escaped. Raw mode sends exact text.
- A member's message renders its Markdown and safe HTML (the same `security` plugin as answers): `<b>` typed in raw mode shows bold.
- Text copied with HTML (a web page) pastes as that HTML, not as Markdown; only plain text (and VS Code's) is parsed.
- Full screen has no Esc: the button or sending ends it.
