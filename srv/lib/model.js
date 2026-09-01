import { ChatOpenAI } from '@langchain/openai'

// Short keep-alive avoids "Premature close" from stale sockets behind
// VPN / TLS-inspecting proxies; honours HTTPS_PROXY / HTTP_PROXY.
let dispatcher
try {
  const undici = await import('undici')
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
  dispatcher = proxyUrl
    ? new undici.ProxyAgent(proxyUrl)
    : new undici.Agent({ keepAliveTimeout: 10, keepAliveMaxTimeout: 10, connections: 64, pipelining: 0 })
} catch {
  dispatcher = null
}

export async function resilientFetch(url, init) {
  if (dispatcher) {
    const { fetch: undiciFetch } = await import('undici')
    return undiciFetch(url, { ...init, dispatcher })
  }
  return fetch(url, init)
}

/**
 * OPENAI_API_KEY env var wins; on BTP fall back to a bound service
 * (e.g. user-provided service with '{"OPENAI_API_KEY":"sk-..."}').
 */
export function openAIConfig() {
  const cfg = {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL,
    baseURL: process.env.OPENAI_BASE_URL,
  }
  try {
    const vcap = JSON.parse(process.env.VCAP_SERVICES || '{}')
    for (const instances of Object.values(vcap)) {
      for (const svc of instances) {
        const c = svc.credentials || {}
        cfg.apiKey = cfg.apiKey || c.OPENAI_API_KEY || c.openai_api_key ||
          (/openai/i.test(svc.name || '') ? c.apikey : undefined)
        cfg.model = cfg.model || c.OPENAI_MODEL || c.openai_model
        cfg.baseURL = cfg.baseURL || c.OPENAI_BASE_URL || c.openai_base_url
      }
    }
  } catch { /* ignore */ }
  return cfg
}

export function model() {
  const cfg = openAIConfig()
  return new ChatOpenAI({
    model: cfg.model || 'gpt-4o-mini',
    temperature: 0,
    apiKey: cfg.apiKey,
    maxRetries: 4,
    timeout: 60000,
    configuration: {
      fetch: resilientFetch,
      baseURL: cfg.baseURL || undefined,
    },
  })
}
