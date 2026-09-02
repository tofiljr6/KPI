# KIP – SAP skill catalog on CAP

A SAP CAP (Node.js) application that manages **skills** — Markdown documents that
describe how to pull a specific piece of data out of SAP: frontmatter
(`name`, `description`, `version`, `last_updated`, `status`), `## Purpose`,
`## Query` (the SQL) and `## Return` (the result shape). See
[docs/skill-markdown.md](docs/skill-markdown.md).

Each document is stored in SAP as a **plain string** in `SkillDescription`, and parsed
back into fields on read — the mapping lives in
[`srv/lib/skillMarkdown.js`](srv/lib/skillMarkdown.js) and round-trips losslessly.

It does three things:

1. **Read/write skills in the SAP on-premise system** through an ABAP OData service.
2. **Generate new skill documents from natural language** with an LLM
   (e.g. _"I need the address data of a business partner"_ → a skill with SELECTs on `BUT020` + `ADRC`).
3. **Answer a data request** by routing it to one stored skill and running that skill's
   query against SAP through the `QuerySet` entity.

## Services

| Service | Base path | Role | Docs |
|---|---|---|---|
| `SkillRepositoryService` | `/skill-repository` | The **only** component that talks to SAP on-premise. Bridges to ABAP OData `ZXXXX_SKILL_SRV` via destination `SA1_300`. | [docs/skill-repository-service.md](docs/skill-repository-service.md) |
| `SkillAuthoringService` | `/skill-authoring` | Natural language → skill definition (LLM). Never calls SAP directly; delegates persistence to `SkillRepositoryService`. | [docs/skill-authoring-service.md](docs/skill-authoring-service.md) |
| `SkillChatService` | `/skill-chat` | Façade for the chat app: slash commands, drafts, and the save/delete buttons. | [docs/skill-chat-app.md](docs/skill-chat-app.md) |
| `SkillRoutingService` | `/skill-routing` | Answers a data request with one stored skill — or says it does not know. | [docs/skill-routing.md](docs/skill-routing.md) |
| `SkillExecutionService` | `/skill-execution` | Runs the chosen skill's query step(s) against SAP — fills placeholders, zero-pads keys, chains multi-table skills, formats the result per `## Return`. | [docs/skill-execution.md](docs/skill-execution.md) |

```
/create-skill ──▶ SkillChatService ──▶ SkillAuthoringService ──(plan ▶ draft ▶ render)──▶ Markdown skill doc
                     │
                     └─ generateAndCreateSkill ─▶ SkillRepositoryService ─▶ ABAP OData ─▶ SAP
                                                       ▲
GET/POST skills ───────────────────────────────────────┘  (destination SA1_300, Cloud Connector)

plain question ─▶ SkillChatService ─▶ SkillRoutingService  (pick one stored skill)
                     │
                     └─ all placeholders filled? ─▶ SkillExecutionService ─▶ SkillRepositoryService
                            fill SELECT, zero-pad keys        │                    └─▶ QuerySet ─▶ SAP
                            format rows per ## Return  ◀───────┘  (result JSON)
```

## Repository layout

```
app/
└── chat/                       Fiori (freestyle UI5) chat app – /chat/index.html
srv/
├── skill-types.cds                 shared types: SkillInput, SkillDoc, SkillQuery
├── skill-repository-service.cds/js  /skill-repository  (SAP bridge: SkillSet + QuerySet)
├── skill-authoring-service.cds/js   /skill-authoring   (LLM generation)
├── skill-routing-service.cds/js     /skill-routing     (question → one stored skill)
├── skill-execution-service.cds/js   /skill-execution   (run the chosen skill's query)
├── skill-chat-service.cds/js        /skill-chat        (chat façade)
└── lib/
    ├── abapSkills.js               ABAP OData calls for SkillSet (destination, CSRF) — repository service only
    ├── abapQuery.js                ABAP OData call for QuerySet (POST + CSRF)        — repository service only
    ├── skillAgent.js               plan → draft pipeline, doc ⇄ SkillInput mapping
    ├── skillMarkdown.js            skill document ⇄ Markdown string (render / parse / validate)
    ├── skillRouter.js              stored skills as tools; picks the one that answers a question
    ├── skillExecutor.js            skill query → QuerySet payload (fields, {placeholder}s, zero-padding); response → rows
    ├── skillAnswer.js              result rows → the answer in the shape the skill's ## Return describes
    ├── sapResearch.js              OpenAI web search → the real SAP tables + field names for a request
    └── model.js                    ChatOpenAI config, model tiers (fast / authoring)
scripts/
├── test-skill-agent.js            generator only, no SAP
├── test-skill-markdown.js         Markdown ⇄ string mapping, fully offline
├── test-skill-router.js           routing wiring, fully offline
├── test-skill-executor.js         QuerySet payload building + result parsing, fully offline
├── test-skill-answer.js           answer formatter with a stubbed model, fully offline
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
- `SkillExecutionService` → `http://localhost:4004/skill-execution`

Hit a snag? [docs/troubleshooting.md](docs/troubleshooting.md).
