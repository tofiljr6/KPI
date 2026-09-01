import { executeHttpRequest } from '@sap-cloud-sdk/http-client'
import { getDestination } from '@sap-cloud-sdk/connectivity'

const DESTINATION_NAME = 'SA1_300'
const SERVICE_PATH = '/sap/opu/odata/sap/ZXXXX_SKILL_SRV'
const ENTITY_SET = 'SkillSet'

async function resolveDestination() {
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
  const res = await executeHttpRequest(d, { params: { '$format': 'json' }, ...request })
  console.log('ABAP status:', res.status)
  return typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
}

async function fetchCsrf(dest) {
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

/** GET SkillSet – raw payload as a string. */
export async function listSkills() {
  return call({ method: 'GET', url: `${SERVICE_PATH}/${ENTITY_SET}` })
}

/** GET SkillSet('<id>') – raw payload as a string. */
export async function readSkill(id) {
  return call({ method: 'GET', url: `${SERVICE_PATH}/${ENTITY_SET}('${encodeURIComponent(id)}')` })
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
