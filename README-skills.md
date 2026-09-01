# SkillsService – ABAP connection test

Direct call to the ABAP REST API through destination **`SA1_300`**
(`@sap-cloud-sdk/http-client` + `getDestination`), no remote model.

## Endpoints

After `cds watch` (service under `/odata/v4/skills-service`):

| Endpoint                              | Calls in ABAP                       |
|--------------------------------------|-------------------------------------|
| `GET /getSkills()`                    | `GET /sap/bc/zxxx_skills`            |
| `GET /getSkill(id='0B385AA0…')`       | `GET /sap/bc/zxxx_skills/{id}`       |

Returns the raw payload as a string and logs `DESTINATION` details plus the HTTP status.

## Run

```bash
npm install
```

### On BTP
- Destination `SA1_300` defined in the subaccount (Connectivity → Destinations).
- App bound to the `destination` and `connectivity` service instances.

### Locally (mac)
BTP destinations are not visible locally – borrow the services from Cloud Foundry:

```bash
cds bind --to <app>-destination --to <app>-connectivity
cds watch --profile hybrid
```

or define the destination locally in `.env` (do not commit):

```
destinations=[{"name":"SA1_300","url":"https://<host>","username":"<user>","password":"<pass>"}]
```
