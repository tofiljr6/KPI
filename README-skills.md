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

   Check the result with `cds bind --resolve --profile hybrid`.

4. Run with the hybrid profile so the SDK routes through the bound services:

   ```bash
   cds watch --profile hybrid
   ```

   If the connectivity proxy is not picked up, start via:

   ```bash
   cds bind --exec -- cds watch --profile hybrid
   ```

Alternatively, skip CF and define the destination locally in `.env` (do not commit):

```
destinations=[{"name":"SA1_300","url":"https://<host>","username":"<user>","password":"<pass>"}]
```
