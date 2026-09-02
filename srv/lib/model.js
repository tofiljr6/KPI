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
 *
 * Two model tiers:
 *   OPENAI_MODEL            – the everyday model (routing, answer formatting, revision
 *                             prose). Default gpt-4o-mini.
 *   OPENAI_AUTHORING_MODEL  – used only to work out the SAP table and the real technical
 *                             field names when generating a skill. Falls back to
 *                             OPENAI_MODEL when unset. Optionally
 *                             OPENAI_AUTHORING_REASONING_EFFORT = low | medium | high
 *                             to run it as a reasoning-model call.
 *   OPENAI_RESEARCH_MODEL   – the web-search model that grounds skill generation in the
 *                             real SAP data model (see srv/lib/sapResearch.js).
 *                             Default gpt-4.1-mini.
 */
export function openAIConfig() {
  const cfg = {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL,
    authoringModel: process.env.OPENAI_AUTHORING_MODEL,
    authoringReasoningEffort: process.env.OPENAI_AUTHORING_REASONING_EFFORT,
    researchModel: process.env.OPENAI_RESEARCH_MODEL,
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
        cfg.authoringModel = cfg.authoringModel || c.OPENAI_AUTHORING_MODEL || c.openai_authoring_model
        cfg.authoringReasoningEffort =
          cfg.authoringReasoningEffort || c.OPENAI_AUTHORING_REASONING_EFFORT || c.openai_authoring_reasoning_effort
        cfg.researchModel = cfg.researchModel || c.OPENAI_RESEARCH_MODEL || c.openai_research_model
        cfg.baseURL = cfg.baseURL || c.OPENAI_BASE_URL || c.openai_base_url
      }
    }
  } catch { /* ignore */ }
  return cfg
}

/**
 * A ChatOpenAI client. `options.tier`:
 *   'fast'      (default) – OPENAI_MODEL / gpt-4o-mini.
 *   'authoring'           – OPENAI_AUTHORING_MODEL (falls back to the fast model); when
 *                           OPENAI_AUTHORING_REASONING_EFFORT is set it becomes a
 *                           reasoning-model call (temperature is dropped).
 */
export function model(options = {}) {
  const cfg = openAIConfig()
  const authoring = options.tier === 'authoring'
  const effort = authoring ? cfg.authoringReasoningEffort : undefined

  const params = {
    model: (authoring && cfg.authoringModel) || cfg.model || 'gpt-4o-mini',
    temperature: 0,
    apiKey: cfg.apiKey,
    maxRetries: 4,
    timeout: authoring ? 120000 : 60000,
    configuration: {
      fetch: resilientFetch,
      baseURL: cfg.baseURL || undefined,
    },
  }

  if (effort) {
    // Reasoning models reject an explicit temperature and take a reasoning effort instead.
    delete params.temperature
    params.reasoningEffort = effort
  }

  return new ChatOpenAI(params)
}
