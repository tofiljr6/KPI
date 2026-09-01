# UI – Skill Authoring (`app/skills`)

A freestyle **SAPUI5 / Fiori** app (no other UI framework). UI5 1.120 is loaded from
`https://ui5.sap.com`, theme `sap_horizon`.

Served by CAP static hosting at **`/skills/index.html`** (the folder is `app/skills`,
deliberately **not** `app/skill-authoring` — that would shadow the OData service path).

## What it does

A single screen (`sap.f.DynamicPage`):

1. **Prompt** – a text area: _"chcę dostać dane adresowe partnera"_ → **Generate**.
2. **Generate** → `POST /skill-authoring/generateSkill`. The returned draft fills an
   **editable form** (`SkillName`, `SkillDescription`, `SkillTriggerText`,
   `QueryTable`, `QueryFields`, `QueryWhere`). Every field can be edited.
3. **Model analysis** – a collapsible panel showing the LLM's `reasoning`, the chosen
   table, key field, `confidence` and alternative tables.
4. **Save to SAP** (footer) → `POST /skill-repository/createSkill` with the (edited)
   form values. Success/failure shown in a `MessageBox`.
5. **Reset** clears the draft; **Regenerate** re-runs generation with the current prompt.

Nothing is persisted until the user hits **Save**.

## Files

```
app/skills/
├── index.html                  UI5 bootstrap (CDN)
├── init.js                     ComponentContainer
├── Component.js
├── manifest.json
├── view/App.view.xml
├── controller/App.controller.js  fetch + CSRF + MessageBox
└── i18n/i18n.properties
```

## How it calls the backend

Plain `fetch` (the app is freestyle, actions are simpler over HTTP than via
`ODataModel`). `controller/App.controller.js`:

- `_csrfToken(serviceRoot)` – `GET <root>` with `X-CSRF-Token: Fetch`, reads the
  response header. Tolerates no token (dev / mocked auth).
- `_postAction(serviceRoot, action, body)` – token, then `POST`, then parse
  `data.value ?? data` and surface `error.message` on failure.

Endpoints used: `/skill-authoring/generateSkill`, `/skill-repository/createSkill`.

## Run

With `cds watch` (see [local-development.md](local-development.md)):

```
http://localhost:4004/skills/index.html
```

## Later

This screen is the skill-creation half. A prompting screen (chat against the user's
own skills) will be added as a second view in the same app.
