# SkillsService – ABAP OData bridge

Direct call to the ABAP OData service through destination **`SA1_300`**
(`@sap-cloud-sdk/http-client` + `getDestination`).

## Backend (OData V2, SAP Gateway)

| Method | URL                                                     |
|--------|---------------------------------------------------------|
| GET    | `/sap/opu/odata/sap/ZXXXX_SKILL_SRV/SkillSet`            |
| GET    | `/sap/opu/odata/sap/ZXXXX_SKILL_SRV/SkillSet('<id>')`    |
| POST   | `/sap/opu/odata/sap/ZXXXX_SKILL_SRV/SkillSet`            |

## CAP endpoints

After `cds watch` (service under `/odata/v4/skills-service`):

| Endpoint                          | Backend call                    |
|----------------------------------|---------------------------------|
| `GET  /getSkills()`               | `GET SkillSet`                  |
| `GET  /getSkill(id='...')`        | `GET SkillSet('<id>')`          |
| `POST /createSkill`               | `POST SkillSet` (+ CSRF token)  |

`createSkill` body:

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

All endpoints return the raw backend payload as a string and log `DESTINATION` details
plus the HTTP status. POST first fetches an `X-CSRF-Token` from the service document.

## Run

```bash
npm install
```

### On BTP
- Destination `SA1_300` defined in the subaccount (Connectivity → Destinations).
- App bound to the `destination` and `connectivity` service instances.

### Locally (mac) – hybrid binding from the terminal

BTP destinations are not visible locally, so bind the Cloud Foundry service
instances into the `hybrid` profile.

1. Log in to Cloud Foundry:

   ```bash
   cf login -a <cf-api-endpoint> -o <org> -s <space>
   ```

2. Make sure the `destination` and `connectivity` service instances exist
   (list them with `cf services`). Create them if missing:

   ```bash
   cf create-service destination lite kip-destination
   cf create-service connectivity lite kip-connectivity
   ```

3. Bind both into the hybrid profile (writes `.cdsrc-private.json`, git-ignored):

   ```bash
   cds bind -2 kip-destination
   cds bind -2 kip-connectivity
   ```

4. Run with the hybrid profile:

   ```bash
   cds watch --profile hybrid
   ```
