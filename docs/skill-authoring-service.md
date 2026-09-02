# SkillAuthoringService

Base path: `/skill-authoring` · Definition: [`srv/skill-authoring-service.cds`](../srv/skill-authoring-service.cds) ·
Implementation: [`srv/skill-authoring-service.js`](../srv/skill-authoring-service.js) → [`srv/lib/skillAgent.js`](../srv/lib/skillAgent.js)

Turns a free-text data request into a skill definition. It does **not** talk to SAP;
for persistence it calls `SkillRepositoryService`.

## Endpoints

| CAP endpoint | What it does |
|---|---|
| `POST /skill-authoring/generateSkill` | natural language → skill draft. No persistence. |
| `POST /skill-authoring/generateAndCreateSkill` | `generateSkill`, then `SkillRepositoryService.createSkill` |

Request body for both:

```json
{ "query": "chcę dostać dane adresowe partnera" }
```

`generateSkill` returns a `GeneratedSkill`:

```json
{
  "query": "chcę dostać dane adresowe partnera",
  "skill": {
    "SkillName": "GetBusinessPartnerAddress",
    "SkillDescription": "...",
    "SkillTriggerText": "Use this skill when the user asks for ...",
    "QueryTable": "BUT020",
    "QueryFields": "PARTNER, ADDRNUMBER",
    "QueryWhere": "PARTNER = '{partner}'"
  },
  "reasoning": "...",
  "tableChoice": {
    "table": "BUT020",
    "keyField": "PARTNER",
    "candidateFields": ["PARTNER", "ADDRNUMBER", "ADR_KIND"],
    "confidence": "high",
    "alternatives": ["ADRC", "BUT021_FS"],
    "notes": "..."
  },
  "error": null
}
```

`generateAndCreateSkill` returns the raw created entity from SAP, or — if generation
failed — the `GeneratedSkill` JSON with `error` set.

## Pipeline (`srv/lib/skillAgent.js`)

Two focused LLM calls, no web search:

1. **`findSapTable`** — a chat prompted as a _senior SAP data-model expert across all
   modules_ (SD, MM, FI/CO, HCM, PP, BP, …). Structured output: the one best
   transparent table, the key field, candidate fields, a `confidence`
   (`high`/`medium`/`low`), and alternative tables.
2. **`draft`** — takes that table choice and produces the `SkillInput` payload
   (`QueryTable`, `QueryFields`, `QueryWhere` with `{placeholder}` tokens) plus a short
   `reasoning`.

Field names are normalised (uppercase, trimmed, de-duplicated).

> Why a dedicated LLM step and not a web search: SAP standard tables are densely
> represented in the model's training data, so a focused prompt is more reliable and
> faster than scraping search results. Real grounding would come from validating the
> chosen fields against the live system's `$metadata` — a future improvement.

## Model configuration (`srv/lib/model.js`)

`ChatOpenAI`, `temperature: 0`. Credentials resolution order:

1. env vars `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-4o-mini`), `OPENAI_BASE_URL`
2. fallback: a bound service in `VCAP_SERVICES` exposing `OPENAI_API_KEY`

`HTTPS_PROXY` / `HTTP_PROXY` are honoured, and a short keep-alive dispatcher avoids
"Premature close" behind TLS-inspecting proxies.

`OPENAI_API_KEY` must be set (in `.env` locally — see [`.env.example`](../.env.example)).

## Testing

```bash
# generator only, no SAP
node --env-file=.env scripts/test-skill-agent.js "chcę dostać dane adresowe partnera"
```

More: [local-development.md](local-development.md#test-scripts).
