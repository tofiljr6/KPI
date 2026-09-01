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

| Endpoint                          | What it does                                   |
|----------------------------------|-----------------------------------------------|
| `GET  /getSkills()`               | `GET SkillSet`                                |
| `GET  /getSkill(id='...')`        | `GET SkillSet('<id>')`                        |
| `POST /createSkill`               | `POST SkillSet` (+ CSRF token)                |
| `POST /generateSkill`             | NL request → skill draft (LangGraph, no save) |
| `POST /generateAndCreateSkill`    | `generateSkill` then `createSkill`            |

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

The GET/POST-to-SkillSet endpoints return the raw backend payload as a string and log
`DESTINATION` details plus the HTTP status. POST first fetches an `X-CSRF-Token`.

### Skill generation (LangChain agent)

`generateSkill` / `generateAndCreateSkill` body:

```json
{ "query": "chcę dostać dane adresowe partnera" }
```

A LangChain tool-calling agent (`srv/lib/skillAgent.js`) with one tool, `search_web`
(`srv/lib/searchTool.js` → Tavily). The agent is instructed to research the SAP
Business Partner data model (BUT000, BUT020, BUT0ID, ADRC, ADR6, …), pick ONE
transparent table, and return the `createSkill` payload: `SkillName`,
`SkillDescription`, `SkillTriggerText`, `QueryTable`, `QueryFields`, `QueryWhere`
plus `reasoning` and `sources`.

Without `TAVILY_API_KEY` the tool returns nothing and the agent falls back to its
own SAP knowledge.

`generateSkill` returns the draft only. `generateAndCreateSkill` also POSTs it to the
ABAP service (returns the draft JSON with `error` set if generation failed).

Requires `OPENAI_API_KEY` in `.env` (see `.env.example`).

Local test without CAP:

```bash
OPENAI_API_KEY=sk-... TAVILY_API_KEY=tvly-... node scripts/test-skill-agent.js "chcę dostać dane adresowe partnera"
```

## Run

```bash
npm install
```

### On BTP
- Destination `SA1_300` defined in the subaccount (Connectivity → Destinations).
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
