# KIP – SAP skill catalog on CAP

A SAP CAP (Node.js) application that manages **skills** — Markdown documents that
describe how to pull a specific piece of data out of SAP: frontmatter
(`name`, `description`, `version`, `last_updated`, `status`), `## Purpose`,
`## Query` (the SQL) and `## Return` (the result shape). See
[docs/skill-markdown.md](docs/skill-markdown.md).

Each document is stored in SAP as a **plain string** in `SkillDescription`, and parsed
back into fields on read — the mapping lives in
[`srv/lib/skillMarkdown.js`](srv/lib/skillMarkdown.js) and round-trips losslessly.

It does two things:

1. **Read/write skills in the SAP on-premise system** through an ABAP OData service.
2. **Generate new skill documents from natural language** with an LLM
   (e.g. _"I need the address data of a business partner"_ → a skill with SELECTs on `BUT020` + `ADRC`).

## Services

| Service | Base path | Role | Docs |
|---|---|---|---|
| `SkillRepositoryService` | `/skill-repository` | The **only** component that talks to SAP on-premise. Bridges to ABAP OData `ZXXXX_SKILL_SRV` via destination `SA1_300`. | [docs/skill-repository-service.md](docs/skill-repository-service.md) |
| `SkillAuthoringService` | `/skill-authoring` | Natural language → skill definition (LLM). Never calls SAP directly; delegates persistence to `SkillRepositoryService`. | [docs/skill-authoring-service.md](docs/skill-authoring-service.md) |
| `SkillChatService` | `/skill-chat` | Façade for the chat app: slash commands, drafts, and the save/delete buttons. | [docs/skill-chat-app.md](docs/skill-chat-app.md) |
| `SkillRoutingService` | `/skill-routing` | Answers a data request with one stored skill — or says it does not know. | [docs/skill-routing.md](docs/skill-routing.md) |

```
/create-skill ──▶ SkillChatService ──▶ SkillAuthoringService ──(plan ▶ draft ▶ render)──▶ Markdown skill doc
                     │
                     └─ generateAndCreateSkill ─▶ SkillRepositoryService ─▶ ABAP OData ─▶ SAP
                                                       ▲
GET/POST skills ───────────────────────────────────────┘  (destination SA1_300, Cloud Connector)
```

## Repository layout

```
app/
└── chat/                       Fiori (freestyle UI5) chat app – /chat/index.html
srv/
├── skill-types.cds                 shared types: SkillInput, SkillDoc, SkillQuery
├── skill-repository-service.cds/js  /skill-repository  (SAP bridge)
├── skill-authoring-service.cds/js   /skill-authoring   (LLM generation)
└── lib/
    ├── abapSkills.js               ABAP OData calls (destination, CSRF)  — used only by the repository service
    ├── skillAgent.js               plan → draft pipeline, doc ⇄ SkillInput mapping
    ├── skillMarkdown.js            skill document ⇄ Markdown string (render / parse / validate)
    ├── skillRouter.js              stored skills as tools; picks the one that answers a question
    └── model.js                    ChatOpenAI config (env or VCAP_SERVICES)
scripts/
├── test-skill-agent.js            generator only, no SAP
├── test-skill-markdown.js         Markdown ⇄ string mapping, fully offline
├── test-skill-router.js           routing wiring, fully offline
├── test-skill-routing-live.js     routing against the real model (needs a key, no SAP)
└── test-save-skill.js             generate + POST to SAP
docs/
├── skill-markdown.md
├── skill-chat-app.md
├── skill-routing.md
├── skill-repository-service.md
├── skill-authoring-service.md
├── local-development.md
└── troubleshooting.md
```

## Quick start

Run in **SAP Business Application Studio** (the on-premise destination is only
reachable from there). Full steps: [docs/local-development.md](docs/local-development.md).

```bash
npm install
cp .env.example .env      # then fill in / generate the values
npx cds watch
```

- **Chat app** → `http://localhost:4004/chat/index.html`
- `SkillRepositoryService` → `http://localhost:4004/skill-repository`
- `SkillAuthoringService` → `http://localhost:4004/skill-authoring`
- `SkillChatService` → `http://localhost:4004/skill-chat`
- `SkillRoutingService` → `http://localhost:4004/skill-routing`

Hit a snag? [docs/troubleshooting.md](docs/troubleshooting.md).
