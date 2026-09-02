import OpenAI from 'openai'
import { openAIConfig } from './model.js'

/**
 * Look up the real SAP tables and technical field names for a data request, using
 * OpenAI's built-in web-search tool so the answer is grounded in the SAP Help Portal /
 * SE11 / SAP community rather than the model's memory alone.
 *
 * This is what stops the skill generator from putting business-partner ID numbers on
 * BUT000 or inventing field names like `PHONE_NUMBER`.
 *
 * Returns a short plain-text briefing, or '' when there is no API key or the call
 * fails — the caller then falls back to model knowledge only.
 */

const PROMPT = (query) =>
  [
    'Research the SAP ERP / S/4HANA data model for the data request below. Use web search',
    'to confirm the EXACT standard transparent tables and their real technical field names',
    '(SAP Help Portal, SE11 documentation, SAP community). Do not rely on memory alone.',
    '',
    `Data request: ${query}`,
    '',
    'Answer concisely:',
    '- the primary table and the key field it is filtered by',
    '- any mapping table needed to reach the data (e.g. BUT020 -> ADDRNUMBER -> ADRC)',
    '- for every table, the exact technical field names that hold the requested data, and',
    '  what each field means',
    'List only fields you could verify. Mark anything uncertain as uncertain.',
  ].join('\n')

/** SDK 4.x names the built-in tool `web_search_preview`; override for newer SDKs. */
const TOOL_TYPE = process.env.OPENAI_WEB_SEARCH_TOOL || 'web_search_preview'

export async function researchSapModel(query, options = {}) {
  const cfg = openAIConfig()
  if (!cfg.apiKey || !String(query || '').trim()) return ''

  const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL || undefined })
  const model = options.model || cfg.researchModel || 'gpt-4.1-mini'

  try {
    const response = await client.responses.create({
      model,
      tools: [{ type: TOOL_TYPE }],
      input: PROMPT(query),
    })
    const text = String(response.output_text || '').trim()
    if (text) console.log(`sapResearch (${model}): ${text.length} chars`)
    return text
  } catch (err) {
    console.error('researchSapModel failed:', err?.message || err)
    return ''
  }
}
