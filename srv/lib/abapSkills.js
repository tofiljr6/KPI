import { executeHttpRequest } from '@sap-cloud-sdk/http-client'
import { getDestination } from '@sap-cloud-sdk/connectivity'

const DESTINATION_NAME = 'SA1_300'
export const SERVICE_PATH = '/sap/opu/odata/sap/ZXXXX_SKILL_SRV'
const ENTITY_SET = 'SkillSet'

export async function resolveDestination() {
  const d = await getDestination({ destinationName: DESTINATION_NAME })
  if (!d) throw new Error(`Destination ${DESTINATION_NAME} not found`)
  console.log('DESTINATION:', {
    name: d.name,
    url: d.url,
    proxyType: d.proxyType,
    authentication: d.authentication,
  })
  return d
}

async function call(request, dest) {
  const d = dest || (await resolveDestination())
  const method = (request.method || 'GET').toUpperCase()
  // $format is a SystemQueryOption – OData V2 only allows it on reads.
  const params = method === 'GET' ? { '$format': 'json' } : undefined
  const res = await executeHttpRequest(d, {
    ...request,
    ...(params ? { params } : {}),
    headers: { Accept: 'application/json', ...(request.headers || {}) },
  })
  console.log('ABAP status:', res.status)
  return typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
}

export async function fetchCsrf(dest) {
  const res = await executeHttpRequest(dest, {
    method: 'GET',
    url: `${SERVICE_PATH}/`,
    headers: { 'X-CSRF-Token': 'Fetch' },
  })
  const setCookie = res.headers['set-cookie']
  return {
    token: res.headers['x-csrf-token'],
    cookie: Array.isArray(setCookie) ? setCookie.map((c) => c.split(';')[0]).join('; ') : undefined,
  }
}

/** OData V2 wraps payloads in { d: … } / { d: { results: [...] } }. */
export function unwrap(raw) {
  const body = typeof raw === 'string' ? JSON.parse(raw) : raw
  const d = body?.d ?? body
  return Array.isArray(d?.results) ? d.results : Array.isArray(d) ? d : [d].filter(Boolean)
}

/**
 * The service-relative path of a stored entity. Taken from its own __metadata.uri,
 * so we never have to guess which property is the entity key; falls back to
 * SkillSet('<SkillName>') when the backend omits __metadata.
 */
export function entityPath(record) {
  const uri = record?.__metadata?.uri
  if (uri) {
    try {
      return new URL(uri).pathname
    } catch {
      return uri.startsWith('/') ? uri : `/${uri}`
    }
  }
  const name = record?.SkillName
  if (!name) throw new Error('Cannot address the skill: no __metadata.uri and no SkillName')
  return `${SERVICE_PATH}/${ENTITY_SET}('${encodeURIComponent(name)}')`
}

/** GET SkillSet – raw payload as a string. */
export async function listSkills() {
  return call({ method: 'GET', url: `${SERVICE_PATH}/${ENTITY_SET}` })
}

/** GET SkillSet – parsed records, __metadata included. */
export async function listSkillRecords() {
  return unwrap(await listSkills())
}

/** GET SkillSet('<id>') – raw payload as a string. */
export async function readSkill(id) {
  return call({ method: 'GET', url: `${SERVICE_PATH}/${ENTITY_SET}('${encodeURIComponent(id)}')` })
}

/** PUT <entity> – replaces a stored skill. Returns a short status string. */
export async function updateSkill(record, skill) {
  const dest = await resolveDestination()
  const csrf = await fetchCsrf(dest)
  return call(
    {
      method: 'PUT',
      url: entityPath(record),
      data: skill,
      headers: {
        'X-CSRF-Token': csrf.token,
        ...(csrf.cookie ? { Cookie: csrf.cookie } : {}),
        'Content-Type': 'application/json',
      },
    },
    dest
  )
}

/** DELETE <entity> – removes a stored skill. */
export async function deleteSkill(record) {
  const dest = await resolveDestination()
  const csrf = await fetchCsrf(dest)
  return call(
    {
      method: 'DELETE',
      url: entityPath(record),
      headers: {
        'X-CSRF-Token': csrf.token,
        ...(csrf.cookie ? { Cookie: csrf.cookie } : {}),
      },
    },
    dest
  )
}

/** POST SkillSet (with CSRF token) – raw created entity as a string. */
export async function createSkill(skill) {
  const dest = await resolveDestination()
  const csrf = await fetchCsrf(dest)
  return call(
    {
      method: 'POST',
      url: `${SERVICE_PATH}/${ENTITY_SET}`,
      data: skill,
      headers: {
        'X-CSRF-Token': csrf.token,
        ...(csrf.cookie ? { Cookie: csrf.cookie } : {}),
        'Content-Type': 'application/json',
      },
    },
    dest
  )
}
