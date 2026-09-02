# SkillExecutionService — running the chosen skill

Base path: `/skill-execution` · [`srv/skill-execution-service.cds`](../srv/skill-execution-service.cds) ·
[`srv/skill-execution-service.js`](../srv/skill-execution-service.js) →
[`srv/lib/skillExecutor.js`](../srv/lib/skillExecutor.js) (query → payload, rows out) +
[`srv/lib/skillAnswer.js`](../srv/lib/skillAnswer.js) (rows → answer)

[`SkillRoutingService`](skill-routing.md) picks the one stored skill that answers a
request. This service is the step after: it takes that skill and the parameter values
from the request, fills the skill's `SELECT`(s) and runs them against SAP.

```
"the city of business partner 5"
  → routing:   GetBusinessPartnerCity   {partner} = 5
  → execution: step 1  SELECT PARTNER, ADDRNUMBER FROM BUT020 WHERE PARTNER = '0000000005'
                       → ADDRNUMBER = '0000012345'
               step 2  SELECT ADDRNUMBER, CITY1 FROM ADRC WHERE ADDRNUMBER = '0000012345'
             → both step results → the answer the skill's ## Return section describes
```

## The backend entity: `QuerySet`

The ABAP OData service `ZXXXX_SKILL_SRV` (destination `SA1_300`) exposes a `QuerySet`
entity that runs one single-table `SELECT` described by the request body:

```
POST /sap/opu/odata/sap/ZXXXX_SKILL_SRV/QuerySet
{
  "TableNmae": "BUT000",
  "Fields": "PARTNER, TYPE, BU_GROUP",
  "WhereClause": "PARTNER = '0000000005'",
  "MaxRows": 10
}
```

`TableNmae` is spelled that way in the ABAP entity — `srv/lib/abapQuery.js` renames
`TableName` to it on the wire, everything above that layer uses `TableName`.

| Field | Meaning |
|---|---|
| `TableNmae` | the SAP table to read |
| `Fields` | field list separated by `, ` — the space is required (`PARTNER, IDNUMBER`, never `PARTNER,IDNUMBER`); one table, no `JOIN` |
| `WhereClause` | the `WHERE` body, without the `WHERE` keyword |
| `MaxRows` | optional — the backend caps at **100** when it is omitted |

The call goes through [`SkillRepositoryService.runQuery`](skill-repository-service.md)
(the only service allowed to touch SAP); the low-level POST with CSRF lives in
[`srv/lib/abapQuery.js`](../srv/lib/abapQuery.js).

**The response** carries the rows as a JSON string in the `result` property
(`{ "d": { ..., "result": "[{…},{…}]" } }`). `extractRows` in `skillExecutor.js` parses
that; it also still handles a plain OData V2 feed as a fallback.

## Formatting the answer (`srv/lib/skillAnswer.js`)

The rows are not dumped as a raw table. `formatSkillAnswer` gives the model the
**question**, the skill's **`## Return`** section (which states the shape of the answer —
a single value, a sentence, a Markdown table with named columns, a bullet list, what an
empty result means) and the rows as JSON, and it writes the answer in that shape, in the
question's language, using only the values in the rows.

If that call fails, `answer` comes back empty and the chat falls back to a raw Markdown
table of the rows.

## From skill query to payload (`srv/lib/skillExecutor.js`)

The skill document's first `## Query` step already carries `table`, `fields` and a
`whereClause` with `{placeholder}` tokens. `buildQueryPayload` turns it into the body
above:

- **Fields** — the field array joined with `, ` (the backend needs the space), upper-cased.
- **WhereClause** — every `{placeholder}` replaced with the request value. Single quotes
  in a value are doubled so it cannot break out of the string literal.
- **Zero-padding** — when a placeholder filters a known key field, a purely numeric value
  shorter than the field width is left-padded with zeros, so `5` finds partner
  `0000000005`. The field is read straight out of the `WHERE` clause (`PARTNER = '{x}'` →
  `PARTNER`). The width map is `ID_FIELD_WIDTH` in `skillExecutor.js`:

  | Width 10 | Width 18 |
  |---|---|
  | `PARTNER` `KUNNR` `LIFNR` `KUNN2` `LIFN2` `GPART` `LIFRE` `KONZS` `EMPFB` `EMPGE` | `MATNR` `EQUNR` |

  Extend the map as more identifiers show up. Non-numeric values (a language key, a name)
  are never touched.

## Multi-step skills (no JOINs)

`QuerySet` runs one single-table `SELECT` — no JOINs. A skill that spans tables has **one
query step per table**, and `runSkill` runs them in order:

1. Run step 1 with the request values.
2. Take step 1's **first row** as `{ column → value }` (`harvestValues`) and add it to the
   value pool.
3. Run step 2 — its `WHERE` placeholder is named after the column it needs
   (`ADDRNUMBER = '{addrnumber}'`, filled from step 1). Repeat for further steps.
4. Format all step results into `answer`; `stepsJson` lists what each step did.

If a later step needs a value no earlier step produced (e.g. step 1 returned nothing),
execution stops there, `note` says why, and `answer` is built from the steps that ran
(`ran` stays `true`).

## What runs, and when

- **Only with every *required* placeholder filled.** "Required" excludes placeholders a
  later step gets from an earlier step (`requiredPlaceholders` in `skillMarkdown.js`) — the
  caller is never asked for `{addrnumber}`. If a required one is missing, `runSkill`
  returns `ran: false` with `missing: [...]` and nothing is sent to SAP.
- The chat runs this **automatically** once routing matches and nothing required is
  missing. A routed skill with a missing placeholder stops at "give me that and I will
  run it".

## Endpoint

`POST /skill-execution/runSkill`

```json
{ "question": "what are the identification numbers of business partner 5",
  "skillName": "GetBusinessPartnerHeader",
  "parameters": [{ "name": "partner", "value": "5" }],
  "maxRows": 10 }
```

returns a `SkillRun`:

| Field | Meaning |
|---|---|
| `ran` | `true` once at least one step ran |
| `answer` | the result formatted per the skill's `## Return` section — what the chat shows; empty when formatting failed |
| `table`, `fields`, `whereClause` | the **last** step, as sent to `QuerySet` (the step that holds the answer data) |
| `requestJson` | the JSON body posted for the **first** step — shown in the chat when a run fails |
| `stepsJson` | `[{ name, table, whereClause, rowCount }]` — one entry per step that ran |
| `maxRows` | the cap that was sent, or `null` for the backend default |
| `rowCount`, `columns`, `rowsJson` | the **last** step's rows (fallback table in the chat) |
| `missing` | required placeholders the caller still owes, when `ran` is false |
| `note` | set when some but not all steps ran; `ran` stays `true` |
| `error` | a hard failure (skill has no query, first step failed) |

## Logs

Every call to `QuerySet` is logged by `srv/lib/abapQuery.js`:

```
QuerySet POST >>> {"url":"/sap/opu/odata/sap/ZXXXX_SKILL_SRV/QuerySet","body":{"TableNmae":"BUT0ID","Fields":"PARTNER, TYPE, IDNUMBER","WhereClause":"PARTNER = '0000000006'"}}
QuerySet POST <<< 201
```

On a failure the second line is `QuerySet POST <<< failed` with `status`, the `sent`
body and the backend `response`. `SkillExecutionService` also logs the resolved
parameters as `runSkill {...}`. The field-list separator lives in one place —
`FIELD_SEPARATOR` in `srv/lib/skillExecutor.js` (currently `", "`).

## Testing

```bash
# payload building, zero-padding, `result` parsing — offline
npm run test:executor
# the answer formatter: what the model is given, trimming — offline (stubbed model)
npm run test:answer
```

The full round trip needs the `SA1_300` destination, so run it in SAP Business
Application Studio (see [local-development.md](local-development.md)).
