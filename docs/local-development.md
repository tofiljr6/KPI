# Local development

## Where to run

Run in **SAP Business Application Studio (BAS)**. The `SA1_300` destination is
on-premise and only reachable through the Cloud Connector wired to the BAS dev space.
It cannot be reached from a laptop, and — importantly — **not** through a manual
`cds bind` either (see [troubleshooting](troubleshooting.md#econnreset-through-the-connectivity-proxy)).

## `.env`

`cds watch` loads `.env` automatically. It must contain:

```
VCAP_SERVICES={...connectivity + destination service keys...}
destinations=[{"name":"SA1_300","url":"http://SA1_300.dest","proxyConfiguration":{"host":"127.0.0.1","port":8887,"protocol":"http"}}]
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

- `127.0.0.1:8887` is BAS's **local connectivity proxy**; it tunnels to the Cloud
  Connector and handles destination auth. The app only ever talks to that port.
- Generate the first two lines automatically: right-click the project in BAS →
  **Bind to Cloud Foundry Services** → select the `connectivity` and `destination`
  instances.
- Template: [`.env.example`](../.env.example). `.env` is git-ignored — never commit the
  real keys.

A correct run logs `url: 'http://SA1_300.dest'` (not `proxyType: OnPremise`).

## Run

```bash
npm install
npx cds watch
```

Do **not** use `cds bind` / `cds watch --profile hybrid` — that routes through
`connectivityproxy.internal.cf...`, which is not reachable from BAS and resets the
connection.

Services:

- `http://localhost:4004/skill-repository`
- `http://localhost:4004/skill-authoring`

## Test scripts

`node` does not read `.env` on its own, so pass `--env-file=.env` (Node 20.6+).

| Command | Needs | Purpose |
|---|---|---|
| `npm run test:markdown` / `test:router` / `test:executor` | nothing | offline unit checks (Markdown mapping, routing wiring, `QuerySet` payload building) |
| `node --env-file=.env scripts/test-skill-agent.js "<query>"` | `OPENAI_API_KEY` | generator only, no SAP call |
| `node --env-file=.env scripts/test-save-skill.js "<query>"` | `.env` full + `OPENAI_API_KEY` | generate a skill **and** POST it to SAP, then read back |
| `node --env-file=.env scripts/test-save-skill.js --skill '<json>'` | `.env` full | POST a hand-written skill (skip generation) |

Example — save a hand-written skill:

```bash
node --env-file=.env scripts/test-save-skill.js --skill '{"SkillName":"GetBpName","SkillDescription":"BP name","SkillTriggerText":"Use this skill when the user asks for a business partner name","QueryTable":"BUT000","QueryFields":"PARTNER, NAME_ORG1","QueryWhere":"PARTNER = '"'"'{partner}'"'"'"}'
```
