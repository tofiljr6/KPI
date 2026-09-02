# SkillRepositoryService

Base path: `/skill-repository` · Definition: [`srv/skill-repository-service.cds`](../srv/skill-repository-service.cds) ·
Implementation: [`srv/skill-repository-service.js`](../srv/skill-repository-service.js) → [`srv/lib/abapSkills.js`](../srv/lib/abapSkills.js)

The single point of contact with the SAP on-premise system. Everything that reads or
writes skills in SAP goes through here; no other part of the app opens a connection to
the backend.

## Backend

ABAP OData V2 service (SAP Gateway), reached via destination **`SA1_300`**
(on-premise, Basic auth, Cloud Connector):

```
GET  /sap/opu/odata/sap/ZXXXX_SKILL_SRV/SkillSet          all skills
GET  /sap/opu/odata/sap/ZXXXX_SKILL_SRV/SkillSet('<id>')  single skill
POST /sap/opu/odata/sap/ZXXXX_SKILL_SRV/SkillSet          create skill
POST /sap/opu/odata/sap/ZXXXX_SKILL_SRV/QuerySet          run one SELECT, get rows
```

Transport: `@sap-cloud-sdk/http-client` `executeHttpRequest` + `@sap-cloud-sdk/connectivity`
`getDestination('SA1_300')`. `SkillSet` calls live in
[`srv/lib/abapSkills.js`](../srv/lib/abapSkills.js), the `QuerySet` call in
[`srv/lib/abapQuery.js`](../srv/lib/abapQuery.js).

## Endpoints

| CAP endpoint | Backend call | Notes |
|---|---|---|
| `GET /skill-repository/getSkills()` | `GET SkillSet` | |
| `GET /skill-repository/getSkill(id='<id>')` | `GET SkillSet('<id>')` | |
| `GET /skill-repository/getSkillDoc(id='<id>')` | `GET SkillSet('<id>')` | `SkillDescription` parsed back into a `SkillDoc` |
| `GET /skill-repository/getSkillDocs()` | `GET SkillSet` | same, for every skill |
| `GET /skill-repository/findSkills(query='...')` | `GET SkillSet` | ranks stored skills against a name or free text |
| `POST /skill-repository/createSkill` | `POST SkillSet` | fetches an `X-CSRF-Token` first |
| `POST /skill-repository/updateSkill` | `PUT <entity>` | replaces a stored skill, addressed by name |
| `POST /skill-repository/deleteSkill` | `DELETE <entity>` | removes a stored skill, addressed by name |
| `POST /skill-repository/runQuery` | `POST QuerySet` | runs one single-table `SELECT`; returns the raw backend JSON |

### `runQuery` request body

```json
{ "TableName": "BUT000", "Fields": "PARTNER, TYPE, BU_GROUP",
  "WhereClause": "PARTNER = '0000000005'", "MaxRows": 10 }
```

`Fields` names are separated by `, ` (the space is required); `MaxRows` is optional (the
backend caps at 100 when omitted). `runQuery` fetches an `X-CSRF-Token` first, like
`createSkill`. It is the only endpoint here that is not about the skills themselves — it
exists so [`SkillExecutionService`](skill-execution.md) has one door to SAP.

On the wire `srv/lib/abapQuery.js` renames `TableName` to `TableNmae` (the ABAP entity's
spelling) and re-joins `Fields` with `FIELD_SEPARATOR`.

`getSkills`, `getSkill` and `createSkill` return the **raw backend payload as a string**
(no remodelling), and log the resolved `DESTINATION` plus the HTTP status.

`getSkillDoc` / `getSkillDocs` are the read side of the Markdown mapping: they unwrap the
OData V2 `{ d: … }` envelope, parse `SkillDescription` with
[`parseSkillMarkdown`](skill-markdown.md) and return
`{ SkillName, SkillTriggerText, QueryTable, markdown, doc, parseWarnings }`.
`parseWarnings` is empty for a well-formed document and lists the problems otherwise
(e.g. a record written before this format).

### `createSkill` request body

```json
{
  "skill": {
    "SkillName": "GetBusinessPartnerAddress",
    "SkillDescription": "---\nname: GetBusinessPartnerAddress\ndescription: ...\nversion: 1.0.0\nlast_updated: 2026-09-02\nstatus: draft\n---\n\n# GetBusinessPartnerAddress\n\n## Cel tego skilla\n...\n\n## Query\n...\n\n## Rückgabe\n...",
    "SkillTriggerText": "Use this skill when the user asks for a business partner address",
    "QueryTable": "BUT020",
    "QueryFields": "PARTNER, ADDRNUMBER",
    "QueryWhere": "PARTNER = '{partner}'"
  }
}
```

`skill` is the shared type `kip.skills.SkillInput` ([`srv/skill-types.cds`](../srv/skill-types.cds)).
**`SkillDescription` carries the whole skill document as a Markdown string** — see
[skill-markdown.md](skill-markdown.md). The `Query*` fields mirror the document's *first*
query and exist for backwards compatibility only.

## Implementation notes (`srv/lib/abapSkills.js`)

- **`$format=json`** is added only on `GET`. OData V2 rejects it on a create
  (`"SystemQueryOptions that are not allowed for this Request Type"`), so `POST` uses
  `Accept: application/json` instead.
- **CSRF**: before `POST`, a `GET <service>/` with `X-CSRF-Token: Fetch` retrieves the
  token and session cookies, which are then sent on the create.
- **Addressing an entity for update/delete**: the record's own `__metadata.uri` from the
  OData V2 payload is used, so the service never has to guess which property is the
  entity key. It falls back to `SkillSet('<SkillName>')` when `__metadata` is absent.
- **`findSkills`** ranks every stored record: an exact name match (case- and
  separator-insensitive) wins and is reported as `match: 'exact'`; otherwise words from the
  query are counted across the name, trigger text and document, and hits come back as
  `match: 'partial'`, best first. The chat service uses this to decide between acting and
  asking the user which skill they meant.
- Errors bubble up as `req.error(status, message)`; the backend error body is logged.

## Testing

See [local-development.md](local-development.md#test-scripts). Quick check once
`cds watch` runs:

```bash
curl -s "http://localhost:4004/skill-repository/getSkills()"
```
