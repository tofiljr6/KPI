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
```

Transport: `@sap-cloud-sdk/http-client` `executeHttpRequest` + `@sap-cloud-sdk/connectivity`
`getDestination('SA1_300')`.

## Endpoints

| CAP endpoint | Backend call | Notes |
|---|---|---|
| `GET /skill-repository/getSkills()` | `GET SkillSet` | |
| `GET /skill-repository/getSkill(id='<id>')` | `GET SkillSet('<id>')` | |
| `POST /skill-repository/createSkill` | `POST SkillSet` | fetches an `X-CSRF-Token` first |

All three return the **raw backend payload as a string** (no remodelling), and log the
resolved `DESTINATION` plus the HTTP status.

### `createSkill` request body

```json
{
  "skill": {
    "SkillName": "GetBusinessPartnerIdentifications",
    "SkillDescription": "Returns identification numbers assigned to a business partner",
    "SkillTriggerText": "Use this skill when the user asks for identification numbers of a business partner",
    "QueryTable": "BUT0ID",
    "QueryFields": "PARTNER, TYPE, IDNUMBER, IDINSTITUTE, ENTRY_DATE, VALID_DATE_FROM, VALID_DATE_TO",
    "QueryWhere": "PARTNER = '{partner}'"
  }
}
```

`skill` is the shared type `kip.skills.SkillInput` ([`srv/skill-types.cds`](../srv/skill-types.cds)):
`SkillName`, `SkillDescription`, `SkillTriggerText`, `QueryTable`, `QueryFields`, `QueryWhere`.

## Implementation notes (`srv/lib/abapSkills.js`)

- **`$format=json`** is added only on `GET`. OData V2 rejects it on a create
  (`"SystemQueryOptions that are not allowed for this Request Type"`), so `POST` uses
  `Accept: application/json` instead.
- **CSRF**: before `POST`, a `GET <service>/` with `X-CSRF-Token: Fetch` retrieves the
  token and session cookies, which are then sent on the create.
- Errors bubble up as `req.error(status, message)`; the backend error body is logged.

## Testing

See [local-development.md](local-development.md#test-scripts). Quick check once
`cds watch` runs:

```bash
curl -s "http://localhost:4004/skill-repository/getSkills()"
```
