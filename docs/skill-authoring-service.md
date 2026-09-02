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
| `POST /skill-authoring/reviseSkill` | existing document + a change request → the revised document |
| `POST /skill-authoring/parseSkillMarkdown` | Markdown string → structured `SkillDoc` |
| `POST /skill-authoring/renderSkillMarkdown` | structured `SkillDoc` → Markdown string |

Request body for the first two (`version` defaults to `1.0.0`, `status` to `draft`):

```json
{ "query": "I need the address data of a business partner", "version": "1.0.0", "status": "draft" }
```

`generateSkill` returns a `GeneratedSkill`:

```json
{
  "query": "I need the address data of a business partner",
  "markdown": "---\nname: GetBusinessPartnerAddress\n...\n## Rückgabe\n...",
  "doc": {
    "name": "GetBusinessPartnerAddress",
    "description": "Returns the address data of a business partner.",
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

Three steps:

0. **`research`** ([`srv/lib/sapResearch.js`](../srv/lib/sapResearch.js)) — OpenAI's
   built-in **web-search** tool (Responses API) confirms the exact SAP tables and real
   technical field names for the request against the SAP Help Portal / SE11 / SAP
   community. Its briefing is passed into the next two steps and treated as authoritative
   over the model's memory. This is what stops the generator from putting business-partner
   ID numbers on `BUT000` or inventing field names like `PHONE_NUMBER`. If there is no API
   key or the call fails, the briefing is empty and the steps fall back to model knowledge.
1. **`plan`** — a chat prompted as a _senior SAP data-model expert across all modules_
   (SD, MM, FI/CO, HCM, PP, BP, …). Structured output: the primary transparent table, its
   key field, candidate fields, a `confidence` (`high`/`medium`/`low`), alternatives, and
   **1–4 execution steps**. `QuerySet` cannot JOIN, so whenever the answer needs columns
   from two or more tables the plan **must** use one step per table — step 1 selects the
   linking key, step 2 filters the next table on it (`BUT020` → `ADDRNUMBER` → `ADRC`),
   with `dependsOn` recording which earlier column feeds the step.
2. **`draft`** — turns that plan into the skill document: frontmatter (`name`,
   `description`, `version`, `last_updated`, `status`), the `## Cel tego skilla` prose, one
   entry per `## Query` step with `{placeholder}` tokens, and the `## Rückgabe` section
   describing the returned columns. All prose is written **in English**, whatever language
   the request itself is in; table and field names stay technical/UPPERCASE.

The document is then normalised, validated (`validateSkillDoc`) and rendered to Markdown
by [`srv/lib/skillMarkdown.js`](../srv/lib/skillMarkdown.js) — the renderer is
deterministic, so the model never writes the SQL layout or the heading structure itself.
`parameters` lists every `{placeholder}` the caller must supply.

> Even better grounding would be to validate the chosen fields against the live system's
> `$metadata` / DDIC — a future improvement on top of the web-search step.

## Revising (`reviseSkill`)

```json
{ "markdown": "<the current document>", "instruction": "add the postal code", "version": "1.1.0" }
```

One LLM call, prompted with the SAP data-model system prompt plus revision rules: return
the **complete** updated document, change only what was asked, keep the rest byte-for-byte,
keep `{placeholder}` tokens, and say so in `reasoning` if the request is impossible.
`version` / `status` override what the current document carries — the chat service passes
the bumped version so the user sees it before saving.

## Model configuration (`srv/lib/model.js`)

`ChatOpenAI`, `temperature: 0`. Credentials: env vars first (`OPENAI_API_KEY`,
`OPENAI_BASE_URL`), then a bound service in `VCAP_SERVICES` exposing `OPENAI_API_KEY`.
`HTTPS_PROXY` / `HTTP_PROXY` are honoured; a short keep-alive dispatcher avoids "Premature
close" behind TLS-inspecting proxies.

| Env var | Used for | Default |
|---|---|---|
| `OPENAI_MODEL` | routing, answer formatting, revision prose (`model()`) | `gpt-4o-mini` |
| `OPENAI_AUTHORING_MODEL` | working out the SAP table + field names when generating a skill (`model({ tier: 'authoring' })`) | falls back to `OPENAI_MODEL` |
| `OPENAI_AUTHORING_REASONING_EFFORT` | run the authoring model as a reasoning call (`low`/`medium`/`high`) — drops `temperature` | unset |
| `OPENAI_RESEARCH_MODEL` | the web-search step (`sapResearch.js`) — must support the built-in web-search tool | `gpt-4.1-mini` |
| `OPENAI_WEB_SEARCH_TOOL` | tool type: `web_search_preview` (openai SDK 4.x) or `web_search` (newer) | `web_search_preview` |

`OPENAI_API_KEY` must be set (in `.env` locally — see [`.env.example`](../.env.example)).

## Testing

```bash
# generator only, no SAP – prints the Markdown document
node --env-file=.env scripts/test-skill-agent.js "I need the address data of a business partner"
node --env-file=.env scripts/test-skill-agent.js "..." --json   # full result object

# the Markdown <-> string mapping, offline (no LLM, no SAP)
node scripts/test-skill-markdown.js
```

More: [local-development.md](local-development.md#test-scripts).
