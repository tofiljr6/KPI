# Skill Chat (Fiori app + SkillChatService)

A freestyle SAPUI5 app in [`app/chat`](../app/chat) with a Claude-style chat surface, plus
the CAP service behind it. Open it at **`http://localhost:4004/chat/index.html`**
once `cds watch` runs.

Everything is in English — the UI, the assistant's replies and the stored skill
documents ([skill-markdown.md](skill-markdown.md)).

## Workflow

Nothing is written to SAP by a command. Commands and plain chat only produce a draft; the
write happens when the user clicks **Save skill** or **Delete skill** on the card. That is
enforced on the server too: `chat` never writes, only `saveSkill` and `confirmDelete` do.

| Input | What happens |
|---|---|
| `/create-skill <description>` | drafts a new skill — **not saved** |
| `/create-skill <existing name>` | opens that stored skill instead of drafting a duplicate |
| `/update-skill <name or text>` | opens a stored skill for editing |
| `/delete-skill <name or text>` | shows the skill with a **Delete skill** button |
| plain message, document open | a revision instruction — the document is rewritten |
| plain message, nothing open | a data request — [routed](skill-routing.md) to the stored skill that answers it |
| `/help` | lists the commands |

The commands are discoverable in three places: the empty-state tiles, a `/create-skill`
chip next to the send button, and an autocomplete list that appears as soon as the input
starts with `/`.

### Drafting and saving

```
/create-skill I need the address data of a business partner
  → SkillChatService.chat → SkillAuthoringService.generateSkill   (plan → draft → render)
  → card with the document, unsaved
[Edit] → the raw Markdown in a textarea, edited by hand
[Save skill] → SkillChatService.saveSkill → SkillRepositoryService.createSkill
```

The card's **Edit** button swaps the rendered document for a monospace textarea. Edits
live in that chat: they are kept on the message, sent with the next turn as `ChatContext`,
and are what **Save skill** persists.

### Changing a stored skill

```
/update-skill GetBusinessPartnerAddress      (or /create-skill with the same name)
  → the stored document is loaded into the chat
"also return the postal code"
  → SkillAuthoringService.reviseSkill → revised document, version bumped
[Save skill (update)] → SkillRepositoryService.updateSkill (PUT)
```

Version handling: the draft shows the bumped version — computed off the **stored** version
kept in the context, so repeated edits stay at one bump — and `saveSkill` guarantees it
regardless of hand edits: `last_updated` is always set to today, and on an update the
version is raised above the stored one if it is not already higher.

### Deleting

`/delete-skill` resolves the argument through `findSkills`. An exact name (or a single
hit) produces a confirmation card with a red border and a **Delete skill** button;
several matches produce a list of candidates to click, which re-issues the command with
the chosen name. The command alone never deletes anything.

### Answering a question

A plain message with no draft open goes to [`SkillRoutingService`](skill-routing.md): every
stored skill becomes a tool and the model must call exactly one of them, or the explicit
`no_matching_skill`. The reply names the skill and the parameter values it found, and shows
the document **read-only** — it is an answer, not a draft, so it carries no buttons and does
not become the chat's editing context.

When nothing fits, the answer is "I do not know how to do that" plus what was missing. The
model cannot fall back on its own SAP knowledge.

### Safety rails

- Buttons appear **only on the newest card**, so a stale draft in the scrollback cannot be
  saved or deleted by accident. Older candidate lists are dimmed and inert.
- `saveSkill` validates the document first: a missing section or a query without a
  resolvable table comes back as an error and SAP is never called.
- A failure at any step — generation, revision, an unreachable backend, a rejected write —
  comes back as an error bubble. A document that was generated but not saved is still
  shown, so nothing is lost.

## SkillChatService

Base path: `/skill-chat` · [`srv/skill-chat-service.cds`](../srv/skill-chat-service.cds) ·
[`srv/skill-chat-service.js`](../srv/skill-chat-service.js)

| Endpoint | Purpose | Writes? |
|---|---|---|
| `POST /skill-chat/chat` | one turn: `{ "message": "...", "context": { … } }` → `ChatReply` | no |
| `POST /skill-chat/saveSkill` | the **Save skill** button: `{ markdown, mode, name, storedVersion }` | yes |
| `POST /skill-chat/confirmDelete` | the **Delete skill** button: `{ name }` | yes |
| `GET /skill-chat/commands()` | the commands the input suggests — single source of truth for the UI | no |

`ChatReply`: `role`, `kind` (`text` \| `skill` \| `delete` \| `choice` \| `error`), `text`
(Markdown for the bubble), `command`, `actions` (`save` \| `delete` — which buttons the
card shows), `markdown`, `skill` (`SkillDoc`), `parameters`, `mode`, `target`,
`storedVersion`, `candidates`, `saved`, `error`.

`ChatContext` — what the UI sends back each turn: `markdown` (as the user last edited it),
`name`, `mode` (`create` \| `update`), `storedVersion`.

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
