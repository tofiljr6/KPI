# Troubleshooting

Issues hit while building this, and what fixed them.

## `ECONNRESET` through the connectivity proxy

**Symptom:** every call to `SA1_300` fails with `read ECONNRESET`; the log shows
`proxyType: 'OnPremise'` and a request to
`connectivityproxy.internal.cf.<region>.hana.ondemand.com:20003`. The TCP connection
to the proxy opens, then is reset right after the request headers are sent.

**Cause:** the app was bound to the CF `connectivity` / `destination` service
instances via `cds bind` (`cds watch --profile hybrid`). That forces traffic through
the internal CF connectivity proxy, which is not reachable from a BAS dev space.

**Fix:** don't `cds bind`. In BAS, use `.env` with the local proxy instead:

```
destinations=[{"name":"SA1_300","url":"http://SA1_300.dest","proxyConfiguration":{"host":"127.0.0.1","port":8887,"protocol":"http"}}]
```

plus `VCAP_SERVICES`. Then run plain `npx cds watch`. A working run logs
`url: 'http://SA1_300.dest'`, `proxyType: undefined`. See
[local-development.md](local-development.md).

## `The Data Services Request contains SystemQueryOptions that are not allowed for this Request Type`

**Symptom:** HTTP 400 from SAP Gateway on `POST SkillSet`.

**Cause:** `$format=json` was appended to the create request. OData V2 only allows
system query options on reads.

**Fix:** `srv/lib/abapSkills.js` now adds `params: { $format: 'json' }` only for `GET`;
`POST` sends `Accept: application/json` instead.

## CSRF token required on write

**Symptom:** HTTP 403 `CSRF token validation failed` on `POST`.

**Fix:** `abapSkills.js` first does `GET <service>/` with `X-CSRF-Token: Fetch`,
then sends the returned token and session cookies on the `POST`.

## `OPENAI_API_KEY environment variable is missing` in a test script

**Cause:** `node script.js` does not read `.env` (only `cds watch` does).

**Fix:** `node --env-file=.env scripts/…` (Node 20.6+).

## `npm install` — `ERESOLVE unable to resolve dependency tree`

**Cause:** `@langchain/community` pulled `typeorm` + `better-sqlite3@<12`, conflicting
with `@cap-js/sqlite`'s `better-sqlite3@12`.

**Fix:** `@langchain/community` was removed. The skill agent uses only
`@langchain/openai` + `@langchain/core` + `zod`.

## Still failing after deploy — Cloud Connector resource allow-list

If a **new** ABAP path (e.g. a different OData service) resets while an existing one
works, check the Cloud Connector: *Cloud To On-Premise* → the backend system for
`SA1_300` → **Resources**. Each URL prefix must be listed explicitly. Add the new
service path (`Path and all sub-paths`). This needs a Cloud Connector administrator.
