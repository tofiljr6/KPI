# UI – Skill Catalog (`app/skills`)

A freestyle **SAPUI5 / Fiori** app (no other UI framework). UI5 1.120 from
`https://ui5.sap.com`, theme `sap_horizon`, libs `sap.m`, `sap.f`, `sap.uxap`,
`sap.ui.layout`.

Served by CAP static hosting at **`/skills/index.html`** (the folder is `app/skills`,
deliberately **not** `app/skill-authoring` — that would shadow the OData service path).

## Screens

One `sap.m.App` (NavContainer) with two pages.

### 1. List Report — `listPage`

- `sap.f.ShellBar` header ("Skill Catalog" / "KIP" + avatar)
- Sub-header toolbar: title + count, `SearchField` (filters by name / table / description),
  refresh, and **Create New Skill** (top-right, emphasized)
- `sap.m.Table` of all skills from `GET /skill-repository/getSkills()`
  (columns: Skill, Table, Fields, Where — the last two pop in on small screens)
- Row press → read-only details dialog (`view/SkillDetails.fragment.xml`)
- Empty state: `IllustratedMessage`

### 2. Object Page — `createPage`

`sap.uxap.ObjectPageLayout` (the Fiori Object Page floorplan):

- **Header title**: the skill name (or "New Skill"), with **Cancel** / **Save** actions
- **Header content**: the natural-language prompt + **Generate**
- **Section "Skill definition"**: editable form — `SkillName`, `SkillDescription`,
  `SkillTriggerText`, `QueryTable`, `QueryFields`, `QueryWhere`
- **Section "Model analysis"** (shown after generate): `reasoning`, chosen table,
  key field, `confidence` (colour-coded), alternatives, candidate fields
- **Footer**: Cancel / Save

Flow: type a prompt → **Generate** (`POST /skill-authoring/generateSkill`) → the form
fills in → edit any field → **Save** (`POST /skill-repository/createSkill`) → back to
the list, which refreshes. Nothing is persisted before Save.

## Files

```
app/skills/
├── index.html                      UI5 bootstrap (CDN)
├── init.js  ·  Component.js  ·  manifest.json
├── view/App.view.xml               list page + object page
├── view/SkillDetails.fragment.xml  row details dialog
├── controller/App.controller.js    fetch + CSRF + navigation
└── i18n/i18n.properties
```

## How it calls the backend

Plain `fetch` (freestyle app; actions are simpler over HTTP than via `ODataModel`).
`controller/App.controller.js`:

- `_csrfToken(root)` – `GET <root>` with `X-CSRF-Token: Fetch`, reads the header
  (tolerates no token in mocked dev)
- `_postAction(root, action, body)` – token → `POST` → parse `data.value ?? data`,
  surface `error.message` on failure
- `_parseCollection(raw)` – unwraps `{d:{results}}` / `{value}` / bare array

Endpoints: `/skill-repository/getSkills()`, `/skill-authoring/generateSkill`,
`/skill-repository/createSkill`.

## Run

With `cds watch` (see [local-development.md](local-development.md)):

```
http://localhost:4004/skills/index.html
```

## Later

A prompting screen (chat against the user's own skills) will be added as a third
page in the same app.
