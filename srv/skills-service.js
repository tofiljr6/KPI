import cds from '@sap/cds'
import { executeHttpRequest } from '@sap-cloud-sdk/http-client'
import { getDestination } from '@sap-cloud-sdk/connectivity'

const DESTINATION_NAME = 'SA1_300'
const SERVICE_PATH = '/sap/opu/odata/sap/ZXXXX_SKILL_SRV'
const ENTITY_SET = 'SkillSet'

export default cds.service.impl(function () {

  this.on('getSkills', async (req) => {
    return odata(req, { method: 'GET', url: `${SERVICE_PATH}/${ENTITY_SET}` })
  })

  this.on('getSkill', async (req) => {
    const { id } = req.data
    if (!id) return req.error(400, 'Missing "id" parameter')
    return odata(req, { method: 'GET', url: `${SERVICE_PATH}/${ENTITY_SET}('${encodeURIComponent(id)}')` })
  })

  this.on('createSkill', async (req) => {
    const { skill } = req.data
    if (!skill || !skill.SkillName) return req.error(400, 'Missing "skill.SkillName"')

    const destination = await resolveDestination(req)
    const csrf = await fetchCsrfToken(destination)

    return odata(req, {
      method: 'POST',
      url: `${SERVICE_PATH}/${ENTITY_SET}`,
      data: skill,
      headers: {
        'X-CSRF-Token': csrf.token,
        ...(csrf.cookie ? { Cookie: csrf.cookie } : {}),
        'Content-Type': 'application/json',
      },
    }, destination)
  })
})

async function resolveDestination(req) {
  const destination = await getDestination({ destinationName: DESTINATION_NAME })
  if (!destination) return req.reject(500, `Destination ${DESTINATION_NAME} not found`)

  console.log('DESTINATION:', {
    name: destination.name,
    url: destination.url,
    proxyType: destination.proxyType,
    authentication: destination.authentication,
  })

  return destination
}

async function fetchCsrfToken(destination) {
  const res = await executeHttpRequest(destination, {
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

async function odata(req, request, destination) {
  try {
    const dest = destination || (await resolveDestination(req))

    const response = await executeHttpRequest(dest, {
      params: { '$format': 'json' },
      ...request,
    })

    console.log('ABAP status:', response.status)

    return typeof response.data === 'string'
      ? response.data
      : JSON.stringify(response.data)

  } catch (err) {
    console.error('CALL FAILED ->', request.method, request.url)
    console.error(err?.response?.data ?? err)
    return req.error(err?.response?.status || 500, err.message)
  }
}
