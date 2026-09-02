import { executeHttpRequest } from '@sap-cloud-sdk/http-client'
import { resolveDestination, fetchCsrf, SERVICE_PATH } from './abapSkills.js'
import { FIELD_SEPARATOR } from './skillExecutor.js'

/**
 * The QuerySet entity of ZXXXX_SKILL_SRV runs one single-table SELECT and returns the
 * rows. It is a "query via POST": the SELECT is described by the request body, not by
 * OData query options.
 *
 *   POST /sap/opu/odata/sap/ZXXXX_SKILL_SRV/QuerySet
 *   { "TableNmae": "BUT000", "Fields": "PARTNER, TYPE, BU_GROUP",
 *     "WhereClause": "PARTNER = '0000000005'", "MaxRows": 10 }
 *
 * `TableNmae` is the backend's spelling of the property, not a typo here.
 * `MaxRows` is optional – the backend caps at 100 when it is left out.
 */
const ENTITY_SET = 'QuerySet'

/** Builds the exact request body posted to QuerySet (also used for logging). */
export function queryRequestBody({ TableName, Fields, WhereClause, MaxRows } = {}) {
  const fields = (Array.isArray(Fields) ? Fields : String(Fields || '').split(/[,\s]+/))
    .map((f) => String(f).trim().toUpperCase())
    .filter(Boolean)

  const body = {
    // The ABAP entity property really is spelled "TableNmae" – match the backend.
    TableNmae: String(TableName || '').trim().toUpperCase(),
    Fields: fields.join(FIELD_SEPARATOR),
    WhereClause: String(WhereClause || '').trim(),
  }
  if (Number.isInteger(MaxRows) && MaxRows > 0) body.MaxRows = MaxRows
  return body
}

/** POST QuerySet (with CSRF token). Returns the raw backend payload as a string. */
export async function runQuery(params = {}) {
  const url = `${SERVICE_PATH}/${ENTITY_SET}`
  const body = queryRequestBody(params)

  console.log('QuerySet POST >>>', JSON.stringify({ url, body }))

  const dest = await resolveDestination()
  const csrf = await fetchCsrf(dest)

  try {
    const res = await executeHttpRequest(dest, {
      method: 'POST',
      url,
      data: body,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf.token,
        ...(csrf.cookie ? { Cookie: csrf.cookie } : {}),
      },
    })
    console.log('QuerySet POST <<<', res.status)
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
  } catch (err) {
    console.error(
      'QuerySet POST <<< failed',
      JSON.stringify({
        status: err?.response?.status,
        sent: body,
        response: err?.response?.data ?? err?.message,
      })
    )
    throw err
  }
}
