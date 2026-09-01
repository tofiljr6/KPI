# UI – Skill Catalog (`app/skills`)

A freestyle **SAPUI5 / Fiori** app (no other UI framework). UI5 1.120 from
`https://ui5.sap.com`, theme `sap_horizon`, libs `sap.m`, `sap.f`,
`sap.ui.layout`, `sap.ui.core`.

Served by CAP static hosting at **`/skills/index.html`** (the folder is `app/skills`,
deliberately **not** `app/skill-authoring` — that would shadow the OData service path).

## Screens

A `sap.f.ShellBar` on top of one `sap.f.FlexibleColumnLayout` (FCL). The FCL
`layout` is bound to `/layout` in the JSON model and driven from the controller:
`OneColumn` (list only) → `TwoColumnsMidExpanded` (list + mid) →
`MidColumnFullScreen` (mid only). Every mid-column page has **Full screen** and
**Close** buttons in its header bar.

### Begin column — list (`listPage`)

- `sap.m.Table` of all skills from `GET /skill-repository/getSkills()` — columns
  Skill, Table (as an `ObjectStatus`), Fields, Where; `autoPopinMode` collapses
  the lower-priority columns when the column narrows; sticky headers + toolbar
- Header toolbar: title + count badge, `SearchField` (filters by
  name / table / description), refresh, and **Create New Skill** (emphasized)
- `mode="SingleSelectMaster"` — selecting a row (`selectionChange`) opens its
  preview in the mid column
- Empty state: `IllustratedMessage` with a Create action

### Mid column — preview (`detailPage`)

Read-only `SimpleForm` with the six skill fields (technical fields monospaced).
The backend has no update operation, so this is preview only.

### Mid column — create (`createPage`)

- Top: the natural-language prompt + **Generate** + a one-line hint
- After generate: a success `MessageStrip`, the editable form (`SkillName`,
  `SkillDescription`, `SkillTriggerText`, `QueryTable`, `QueryFields`,
  `QueryWhere`; required markers on name/table), and a collapsed **Model
  analysis** `Panel` (`reasoning`, chosen table, key field, colour-coded
  `confidence`, alternatives, candidate fields)
- Footer: Cancel / Save

Flow: type a prompt → **Generate** (`POST /skill-authoring/generateSkill`) → the
form appears → edit any field → **Save** (`POST /skill-repository/createSkill`) →
the mid column closes and the list refreshes. Nothing is persisted before Save.

## Files

```
app/skills/
├── index.html                      UI5 bootstrap (CDN) + loading splash
├── init.js  ·  Component.js  ·  manifest.json
├── view/App.view.xml               ShellBar + FlexibleColumnLayout (list / preview / create)
├── controller/App.controller.js    fetch + CSRF + FCL layout handling
├── css/style.css                   small polish on top of sap_horizon
└── i18n/i18n.properties
```

`css/style.css` is registered via `sap.ui5/resources/css` in `manifest.json`
(monospace for technical fields, create-form max-width).

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

A prompting screen (chat against the user's own skills) could be added as an
end column in the same FCL.
