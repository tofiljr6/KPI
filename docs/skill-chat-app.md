# Skill Chat (Fiori app + SkillChatService)

A freestyle SAPUI5 app in [`app/chat`](../app/chat) with a Claude-style chat surface, plus
the CAP service behind it. Open it at **`http://localhost:4004/chat/index.html`**
once `cds watch` runs.

The whole UI is in English; only the stored skill document keeps its
`## Cel tego skilla` / `## Rückgabe` headings ([skill-markdown.md](skill-markdown.md)).

## Workflow

Plain chat **does nothing on its own** — the assistant answers that it only acts on
commands and points at `/create-skill`. The commands are discoverable in three places:
the empty-state tiles, a `/create-skill` chip next to the send button, and an
autocomplete list that appears as soon as the input starts with `/`.

| Input | What happens |
|---|---|
| anything without a leading `/` | a short reply explaining that only commands act, with an example |
| `/help` | lists the commands |
| `/create-skill <description>` | generate → validate → save, then show the document |
| `/create-skill` (no description) | asks for the description |
| any other `/command` | "I do not know the command …" plus the command list |

`/create-skill` runs the full chain and answers with a collapsible card holding the
generated Markdown document (with a **Copy Markdown** button):

```
UI → SkillChatService.chat
       → SkillAuthoringService.generateSkill   (plan → draft → render)
       → SkillRepositoryService.createSkill    (POST SkillSet, SkillDescription = Markdown)
```

Failures never break the thread: a generation error, an incomplete document or a failed
save each come back as an error bubble. When the document was generated but the save
failed, the card is still shown (with an amber border) so nothing is lost.

## SkillChatService

Base path: `/skill-chat` · [`srv/skill-chat-service.cds`](../srv/skill-chat-service.cds) ·
[`srv/skill-chat-service.js`](../srv/skill-chat-service.js)

| Endpoint | Purpose |
|---|---|
| `POST /skill-chat/chat` | one turn: `{ "message": "/create-skill ..." }` → `ChatReply` |
| `GET /skill-chat/commands()` | the commands the input suggests — single source of truth for the UI |

`ChatReply`: `role`, `kind` (`text` \| `skill` \| `error`), `text` (Markdown for the
bubble), `command`, `markdown`, `skill` (`SkillDoc`), `parameters`, `saved`, `error`.

The service is a façade: it never calls the LLM or SAP itself, it only routes to the two
existing services. Provider errors are trimmed to their first line (240 chars) and
wrapped in a fenced block so a stack trace cannot blow up the layout.

## App structure

```
app/chat/
├── index.html                  UI5 bootstrap (CDN, sap_horizon)
├── Component.js / manifest.json
├── view/Chat.view.xml          top bar · scrollable thread · composer
├── controller/Chat.controller.js
├── model/markdown.js           Markdown -> HTML for the bubbles and the document card
└── css/style.css               the Claude-like surface on top of Horizon
```

`model/markdown.js` renders headings, fenced code, tables, lists, inline formatting and
YAML frontmatter (as a metadata table). Everything is HTML-escaped first, so only tags
produced by the renderer can reach the DOM.

### Things that will bite you again

- **`{placeholder}` tokens.** `new Control({ text: '…{partner}…' })` runs the UI5 binding
  parser over the string and silently swallows the token. Every generated string goes
  through a setter instead (`_html()`, `setText()`), never through a constructor.
- **Flex layout.** `sap.m.VBox` wraps each child in a `.sapMFlexItem` div with
  `min-height: auto`, which stops the thread from shrinking and pushes the composer off
  screen. The root uses `renderType="Bare"`, and the height comes from CSS
  (`100dvh`) — an inline `height="100%"` from XML resolves against a content-sized
  `ComponentContainer` and beats the stylesheet.
- **Scrolling.** `ScrollContainer#scrollTo` does not move the container; assign
  `scrollTop` on its DOM node.
- **Enter to send.** The keydown handler checks `key` *and* `keyCode`, because some
  environments dispatch keydown without `key`.

## Local run

```bash
npx cds watch
```

Then open `http://localhost:4004/chat/index.html`. `/create-skill` needs a working
`OPENAI_API_KEY` in `.env`; saving to SAP additionally needs the `SA1_300` destination,
so run it in BAS if you want the full round trip.
