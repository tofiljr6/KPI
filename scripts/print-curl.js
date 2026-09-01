import { getDestination } from '@sap-cloud-sdk/connectivity'

const destinationName = process.env.BP_DESTINATION || 'SA1_300'
const destination = await getDestination({ destinationName })

if (!destination) {
  console.error(`Destination ${destinationName} not found`)
  process.exit(1)
}

const authHeader = destination.username && destination.password
  ? 'Basic ' + Buffer.from(`${destination.username}:${destination.password}`).toString('base64')
  : null

const proxy = destination.proxyConfiguration

console.log('DESTINATION:', {
  name: destination.name,
  url: destination.url,
  proxyType: destination.proxyType,
  authentication: destination.authentication,
  proxy: proxy ? { host: proxy.host, port: proxy.port, headers: Object.keys(proxy.headers || {}) } : null,
})

function printCurl(label, path) {
  const url = `${destination.url}${path}`
  const parts = ["curl -v -sS -H 'Connection: Keep-Alive'"]
  if (proxy) parts.push(`-x http://${proxy.host}:${proxy.port}`)
  for (const [key, value] of Object.entries(proxy?.headers || {})) {
    parts.push(`-H '${key}: ${value}'`)
  }
  if (authHeader) parts.push(`-H 'Authorization: ${authHeader}'`)
  parts.push("-H 'sap-client: 300'")
  parts.push(`'${url}'`)

  console.log(`\n# ${label}`)
  console.log(parts.join(' \\\n  '))
}

printCurl(
  'WORKING path (Business Partner OData)',
  "/sap/opu/odata/sap/ZMTO_AI_BP_SRV/BusinessPartnerSet('0000000005')/Identifications?$format=json"
)

printCurl('FAILING path (skills)', '/sap/bc/zxxx_skills')
