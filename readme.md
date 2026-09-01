# KIP – SAP skill catalog on CAP

A SAP CAP (Node.js) application that manages **skills** — small metadata records that
describe how to pull a specific piece of data out of an SAP table
(`SkillName`, `SkillTriggerText`, `QueryTable`, `QueryFields`, `QueryWhere`, …).

It does two things:

1. **Read/write skills in the SAP on-premise system** through an ABAP OData service.
2. **Generate new skill definitions from natural language** with an LLM
   (e.g. _"chcę dostać dane adresowe partnera"_ → a skill on `BUT020` / `ADRC`).

## Services

| Service | Base path | Role | Docs |
|---|---|---|---|
| `SkillRepositoryService` | `/skill-repository` | The **only** component that talks to SAP on-premise. Bridges to ABAP OData `ZXXXX_SKILL_SRV` via destination `SA1_300`. | [docs/skill-repository-service.md](docs/skill-repository-service.md) |
| `SkillAuthoringService` | `/skill-authoring` | Natural language → skill definition (LLM). Never calls SAP directly; delegates persistence to `SkillRepositoryService`. | [docs/skill-authoring-service.md](docs/skill-authoring-service.md) |

```
NL query ──▶ SkillAuthoringService ──(findSapTable ▶ draft)──▶ skill draft
                     │
                     └─ generateAndCreateSkill ─▶ SkillRepositoryService ─▶ ABAP OData ─▶ SAP
                                                       ▲
GET/POST skills ───────────────────────────────────────┘  (destination SA1_300, Cloud Connector)
```

## Repository layout

```
srv/
├── skill-types.cds                 shared type kip.skills.SkillInput
├── skill-repository-service.cds/js  /skill-repository  (SAP bridge)
├── skill-authoring-service.cds/js   /skill-authoring   (LLM generation)
└── lib/
    ├── abapSkills.js               ABAP OData calls (destination, CSRF)  — used only by the repository service
    ├── skillAgent.js               findSapTable → draft pipeline
    └── model.js                    ChatOpenAI config (env or VCAP_SERVICES)
scripts/
├── test-skill-agent.js            generator only, no SAP
└── test-save-skill.js             generate + POST to SAP
docs/
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

- `SkillRepositoryService` → `http://localhost:4004/odata/v4/skill-repository`
- `SkillAuthoringService` → `http://localhost:4004/odata/v4/skill-authoring`

Hit a snag? [docs/troubleshooting.md](docs/troubleshooting.md).
