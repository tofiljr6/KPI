import cds from '@sap/cds'
import { executeHttpRequest } from '@sap-cloud-sdk/http-client'
import { getDestination } from '@sap-cloud-sdk/connectivity'

const DESTINATION_NAME = 'SA1_300'
const BASE_PATH = '/sap/bc/zxxx_skills'

export default cds.service.impl(function () {

  this.on('getSkills', async (req) => {
    return callAbap(req, BASE_PATH)
  })

  this.on('getSkill', async (req) => {
    const { id } = req.data
    if (!id) return req.error(400, 'Missing "id" parameter')
    return callAbap(req, `${BASE_PATH}/${encodeURIComponent(id)}`)
  })
})

async function callAbap(req, url) {
  try {
    const destination = await getDestination({ destinationName: DESTINATION_NAME })

    if (!destination) {
      return req.error(500, `Destination ${DESTINATION_NAME} not found`)
    }

    console.log('DESTINATION:', {
      name: destination.name,
      url: destination.url,
      proxyType: destination.proxyType,
      authentication: destination.authentication,
    })

    const response = await executeHttpRequest(destination, { method: 'GET', url })

    console.log('ABAP status:', response.status)

    return typeof response.data === 'string'
      ? response.data
      : JSON.stringify(response.data)

  } catch (err) {
    console.error('CALL FAILED ->', url)
    console.error(err)
    return req.error(500, err.message)
  }
}
