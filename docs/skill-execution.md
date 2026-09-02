# SkillExecutionService — running the chosen skill

Base path: `/skill-execution` · [`srv/skill-execution-service.cds`](../srv/skill-execution-service.cds) ·
[`srv/skill-execution-service.js`](../srv/skill-execution-service.js) →
[`srv/lib/skillExecutor.js`](../srv/lib/skillExecutor.js)

[`SkillRoutingService`](skill-routing.md) picks the one stored skill that answers a
request. This service is the step after: it takes that skill and the parameter values
from the request, fills the skill's `SELECT` and runs it against SAP.

```
"the group and type of business partner 5"
  → routing:   GetBusinessPartnerHeader   {partner} = 5
  → execution: SELECT PARTNER, TYPE, BU_GROUP FROM BUT000 WHERE PARTNER = '0000000005'
             → the rows
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

## What runs, and when

- **Only the first query.** Multi-step skills (step 2 consuming a value from step 1) run
  step 1 only for now.
- **Only with every placeholder filled.** If the request is missing one, `runSkill`
  returns `ran: false` with `missing: [...]` and nothing is sent to SAP — the chat asks
  the user for the value instead.
- The chat runs this **automatically** once routing matches and no placeholder is
  missing. A routed skill with a missing placeholder stops at "give me that and I will
  run it".

## Endpoint

`POST /skill-execution/runSkill`

```json
{ "skillName": "GetBusinessPartnerHeader",
  "parameters": [{ "name": "partner", "value": "5" }],
  "maxRows": 10 }
```

returns a `SkillRun`:

| Field | Meaning |
|---|---|
| `ran` | `true` only when the `SELECT` actually executed |
| `table`, `fields`, `whereClause` | the query as sent to `QuerySet` (`whereClause` has the values substituted) |
| `requestJson` | the exact JSON body posted to `QuerySet` — shown in the chat when a run fails |
| `maxRows` | the cap that was sent, or `null` for the backend default |
| `rowCount` | number of rows returned |
| `columns` | column names (from the first row, or the skill's field list when empty) |
| `rowsJson` | the rows as a JSON array of objects — dynamic columns, so a string |
| `missing` | placeholders still without a value, when `ran` is false |
| `error` | the backend error, when the call failed |

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
# payload building, zero-padding, response unwrapping — offline
npm run test:executor
```

The full round trip needs the `SA1_300` destination, so run it in SAP Business
Application Studio (see [local-development.md](local-development.md)).
