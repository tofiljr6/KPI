# SkillAuthoringService

Base path: `/skill-authoring` · Definition: [`srv/skill-authoring-service.cds`](../srv/skill-authoring-service.cds) ·
Implementation: [`srv/skill-authoring-service.js`](../srv/skill-authoring-service.js) → [`srv/lib/skillAgent.js`](../srv/lib/skillAgent.js)

Turns a free-text data request into a **skill document in Markdown**
([format](skill-markdown.md)). It does **not** talk to SAP; for persistence it calls
`SkillRepositoryService`.

## Endpoints

| CAP endpoint | What it does |
|---|---|
| `POST /skill-authoring/generateSkill` | natural language → skill document. No persistence. |
| `POST /skill-authoring/generateAndCreateSkill` | `generateSkill`, then `SkillRepositoryService.createSkill` |
| `POST /skill-authoring/parseSkillMarkdown` | Markdown string → structured `SkillDoc` |
| `POST /skill-authoring/renderSkillMarkdown` | structured `SkillDoc` → Markdown string |

Request body for the first two (`version` defaults to `1.0.0`, `status` to `draft`):

```json
{ "query": "chcę dostać dane adresowe partnera", "version": "1.0.0", "status": "draft" }
```

`generateSkill` returns a `GeneratedSkill`:

```json
{
  "query": "chcę dostać dane adresowe partnera",
  "markdown": "---\nname: GetBusinessPartnerAddress\n...\n## Rückgabe\n...",
  "doc": {
    "name": "GetBusinessPartnerAddress",
    "description": "Zwraca dane adresowe partnera biznesowego.",
    "version": "1.0.0",
    "lastUpdated": "2026-09-02",
    "status": "draft",
    "purpose": "...",
    "queries": [
      {
        "name": "Numer adresu partnera",
        "description": "Mapuje PARTNER na ADDRNUMBER.",
        "table": "BUT020",
        "fields": ["PARTNER", "ADDRNUMBER"],
        "whereClause": "PARTNER = '{partner}'",
        "sql": "SELECT PARTNER, ADDRNUMBER\n  FROM BUT020\n WHERE PARTNER = '{partner}'"
      }
    ],
    "returns": "..."
  },
  "skill": {
    "SkillName": "GetBusinessPartnerAddress",
    "SkillDescription": "<the whole markdown document>",
    "SkillTriggerText": "Use this skill when the user asks for ...",
    "QueryTable": "BUT020",
    "QueryFields": "PARTNER, ADDRNUMBER",
    "QueryWhere": "PARTNER = '{partner}'"
  },
  "parameters": ["partner", "addrnumber"],
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

`skill` is `null` and `error` is set when the generated document fails validation
(missing section, query without a resolvable table, …); `markdown` and `doc` are still
returned so the draft can be inspected or fixed by hand.

`generateAndCreateSkill` returns the raw created entity from SAP, or — if generation
failed — the `GeneratedSkill` JSON with `error` set.

## Pipeline (`srv/lib/skillAgent.js`)

Two focused LLM calls, no web search:

1. **`plan`** — a chat prompted as a _senior SAP data-model expert across all modules_
   (SD, MM, FI/CO, HCM, PP, BP, …). Structured output: the primary transparent table, its
   key field, candidate fields, a `confidence` (`high`/`medium`/`low`), alternatives, and
   **1–4 execution steps** — each step one single-table `SELECT`, no JOINs. Extra steps
   are for data reached through a mapping table (`BUT020` → `ADDRNUMBER` → `ADRC`); a
   `dependsOn` field records which earlier value a step consumes.
2. **`draft`** — turns that plan into the skill document: frontmatter (`name`,
   `description`, `version`, `last_updated`, `status`), the `## Cel tego skilla` prose, one
   entry per `## Query` step with `{placeholder}` tokens, and the `## Rückgabe` section
   describing the returned columns. Prose is written **in the language of the request**;
   table and field names stay technical/UPPERCASE.

The document is then normalised, validated (`validateSkillDoc`) and rendered to Markdown
by [`srv/lib/skillMarkdown.js`](../srv/lib/skillMarkdown.js) — the renderer is
deterministic, so the model never writes the SQL layout or the heading structure itself.
`parameters` lists every `{placeholder}` the caller must supply.

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
# generator only, no SAP – prints the Markdown document
node --env-file=.env scripts/test-skill-agent.js "chcę dostać dane adresowe partnera"
node --env-file=.env scripts/test-skill-agent.js "..." --json   # full result object

# the Markdown <-> string mapping, offline (no LLM, no SAP)
node scripts/test-skill-markdown.js
```

More: [local-development.md](local-development.md#test-scripts).
