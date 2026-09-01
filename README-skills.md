# Skills – two CAP services

| Service | Path | Job |
|---|---|---|
| `SkillRepositoryService` | `/skill-repository` | **The only** service that talks to SAP on-premise. Bridges to the ABAP OData service `ZXXXX_SKILL_SRV` via destination `SA1_300`. |
| `SkillAuthoringService`  | `/skill-authoring`  | Turns a natural-language request into a skill definition (LLM + web search). For persistence it calls `SkillRepositoryService`. |

Shared payload shape: `srv/skill-types.cds` → `kip.skills.SkillInput`
(`SkillName`, `SkillDescription`, `SkillTriggerText`, `QueryTable`, `QueryFields`, `QueryWhere`).

---

## SkillRepositoryService  (`/skill-repository`)

Implementation: `srv/skill-repository-service.js` → `srv/lib/abapSkills.js`
(`@sap-cloud-sdk/http-client` + `getDestination`).

| Endpoint                     | Backend call                         |
|-----------------------------|--------------------------------------|
| `GET  /getSkills()`          | `GET SkillSet`                       |
| `GET  /getSkill(id='...')`   | `GET SkillSet('<id>')`               |
| `POST /createSkill`          | `POST SkillSet` (+ `X-CSRF-Token`)   |

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

Returns the raw backend payload as a string; logs `DESTINATION` details + HTTP status.

---

## SkillAuthoringService  (`/skill-authoring`)

Implementation: `srv/skill-authoring-service.js` → `srv/lib/skillAgent.js`.

| Endpoint                          | What it does                                             |
|----------------------------------|---------------------------------------------------------|
| `POST /generateSkill`             | NL request → skill draft (LLM). No persistence.         |
| `POST /generateAndCreateSkill`    | `generateSkill`, then `SkillRepositoryService.createSkill` |

Body:

```json
{ "query": "chcę dostać dane adresowe partnera" }
```

`srv/lib/skillAgent.js` — system prompt = senior SAP expert across all modules
(SD, MM, FI/CO, HCM, PP, BP, …). Three steps:

1. **assess** – does the model already know the exact table + fields? If not, it
   emits a web search query.
2. **research** – keyless web search via `duck-duck-scrape` (biased to SAP) + the
   top result's page text. No API key needed.
3. **draft** – structured output: `SkillInput` + `reasoning` + `sources`.

`generateSkill` returns the draft. `generateAndCreateSkill` also POSTs it through
`SkillRepositoryService` (returns the draft JSON with `error` set if generation failed).

Requires `OPENAI_API_KEY` in `.env` (see `.env.example`).

### Test scripts

Generator only (no CAP, no SAP):

```bash
node --env-file=.env scripts/test-skill-agent.js "chcę dostać dane adresowe partnera"
```

End-to-end (generate **and** save to SAP — run inside BAS):

```bash
node --env-file=.env scripts/test-save-skill.js "chcę dostać dane adresowe partnera"
```

Save a hand-written skill directly (skip generation):

```bash
node --env-file=.env scripts/test-save-skill.js --skill '{"SkillName":"GetBpName","SkillDescription":"BP name","SkillTriggerText":"Use this skill when the user asks for a business partner name","QueryTable":"BUT000","QueryFields":"PARTNER, NAME_ORG1, NAME_LAST, NAME_FIRST","QueryWhere":"PARTNER = '"'"'{partner}'"'"'"}'
```

(`node` doesn't read `.env` on its own — `cds watch` does. `--env-file` needs Node 20.6+.)

---

## Run

```bash
npm install
```

### On BTP
- Destination `SA1_300` in the subaccount (Connectivity → Destinations).
- App bound to the `destination` and `connectivity` service instances.

### Locally in SAP Business Application Studio (BAS)

The `SA1_300` destination is on-premise (reached via a Cloud Connector). BAS runs a
local connectivity proxy at `127.0.0.1:8887` that tunnels to it. The app must be
pointed at that proxy through a **`.env` file** — without it every call fails with
`ECONNRESET`.

1. Create `.env` from the template:

   ```bash
   cp .env.example .env
   ```

   Then either fill in the values, or generate them: right-click the project in BAS →
   **Bind to Cloud Foundry Services** → pick the `connectivity` and `destination`
   instances. That writes `VCAP_SERVICES` plus the `destinations` line with the
   `127.0.0.1:8887` proxy into `.env`.

   The `.env` must contain:

   ```
   VCAP_SERVICES={...connectivity + destination service keys...}
   destinations=[{"name":"SA1_300","url":"http://SA1_300.dest","proxyConfiguration":{"host":"127.0.0.1","port":8887,"protocol":"http"}}]
   ```

2. Run plain `cds watch`:

   ```bash
   npx cds watch
   ```

   **Do NOT** use `cds bind` / `cds watch --profile hybrid` — that forces the
   `connectivityproxy.internal.cf...` route, which is not reachable from BAS and
   resets the connection. `.env` + the BAS local proxy is the working path.

A correct run logs `url: 'http://SA1_300.dest'` (not `proxyType: OnPremise`).

`.env` is git-ignored — never commit the real service keys.
