import { z } from 'zod'
import { model } from './model.js'
import { webSearch, fetchPageText } from './webSearch.js'

const EXPERT_SYSTEM = [
  'You are a senior SAP expert across all modules (SD, MM, FI/CO, HCM/HR, PP, WM/EWM, PM, PS,',
  'BP/BDT, CS, QM, ...). You know SAP application tables and their technical field names.',
  '',
  'Reference examples (non-exhaustive):',
  '- Business Partner: BUT000, BUT020, BUT021_FS, ADRC, ADR2, ADR3, ADR6, BUT0ID, BUT0BK, BUT100',
  '- Material (MM): MARA, MARC, MAKT, MBEW, MARD, MVKE',
  '- Sales (SD): VBAK, VBAP, VBRK, VBRP, LIKP, LIPS, KNA1, KNVV',
  '- Purchasing (MM): EKKO, EKPO, EKBE, LFA1, LFB1',
  '- Finance (FI): BKPF, BSEG, BSID, BSIK, SKA1, SKB1, FAGLFLEXA',
  '- Controlling (CO): COEP, COBK, CSKS, CSKT',
  '- HCM (HR): PA0001, PA0002, PA0006, PA0105, HRP1000',
  '',
  'Rules for the skill you produce:',
  '- The skill runs as a SINGLE OpenSQL SELECT on exactly ONE transparent table.',
  '- Pick the ONE table that best answers the request, from the correct module.',
  '- Use real SAP technical table and field names only. Never invent names.',
  '- If you are not fully sure of the exact table or fields, use the provided web research.',
  '- QueryFields: comma-separated real technical field names of that table.',
  "- QueryWhere: a WHERE clause using {placeholder} tokens for runtime values,",
  "  e.g. \"MATNR = '{matnr}'\" or \"PARTNER = '{partner}'\".",
].join('\n')

const assessSchema = z.object({
  confident: z
    .boolean()
    .describe('true only if you already know the exact SAP table and its real field names for this request'),
  module: z.string().describe('SAP module guess, e.g. BP, MM, SD, FI, CO, HR'),
  searchQuery: z
    .string()
    .describe('Concise English web search query to find the SAP table/fields; empty string if confident'),
})

const skillSchema = z.object({
  SkillName: z.string().describe('PascalCase, no spaces, e.g. GetBusinessPartnerAddress'),
  SkillDescription: z.string().describe('One sentence: what data this skill returns'),
  SkillTriggerText: z.string().describe('Starts with "Use this skill when the user asks for ..."'),
  QueryTable: z.string().describe('ONE SAP transparent table, UPPERCASE technical name'),
  QueryFields: z.string().describe('Comma-separated real technical field names of that table'),
  QueryWhere: z.string().describe("WHERE clause with {placeholder} tokens, e.g. \"PARTNER = '{partner}'\""),
  reasoning: z.string().describe('1-2 sentences on the table/field choice'),
})

function normalize(skill) {
  return {
    SkillName: (skill.SkillName || '').trim(),
    SkillDescription: (skill.SkillDescription || '').trim(),
    SkillTriggerText: (skill.SkillTriggerText || '').trim(),
    QueryTable: (skill.QueryTable || '').toUpperCase().trim(),
    QueryFields: (skill.QueryFields || '')
      .split(',')
      .map((f) => f.trim().toUpperCase())
      .filter(Boolean)
      .join(', '),
    QueryWhere: (skill.QueryWhere || '').trim(),
  }
}

/**
 * Natural-language data request -> skill definition in SkillsService.createSkill shape.
 * 1. assess: does the model know the table/fields? if not, produce a search query
 * 2. research: keyless web search (DuckDuckGo, SAP-biased) + top page text
 * 3. draft: structured skill output
 */
export async function runSkillAgent(query) {
  const assess = await model().withStructuredOutput(assessSchema).invoke([
    { role: 'system', content: EXPERT_SYSTEM + '\n\nFirst, assess your own certainty.' },
    { role: 'user', content: `Data request: ${query}` },
  ])

  let research = ''
  const sources = []

  if (!assess.confident && assess.searchQuery) {
    const { results } = await webSearch(assess.searchQuery, { maxResults: 5 })
    for (const r of results) {
      sources.push({ title: r.title, url: r.url })
      research += `\n- ${r.title}\n  ${r.url}\n  ${r.snippet}`
    }
    if (results[0]?.url) {
      const text = await fetchPageText(results[0].url)
      if (text) research += `\n\nTop result content (${results[0].url}):\n${text}`
    }
  }

  const draft = await model().withStructuredOutput(skillSchema).invoke([
    { role: 'system', content: EXPERT_SYSTEM },
    {
      role: 'user',
      content:
        `Data request: ${query}\n` +
        `Module (guess): ${assess.module}\n\n` +
        (research ? `Web research (SAP):${research}` : 'No web research available; use your own knowledge.'),
    },
  ])

  const reasoning = draft.reasoning || null
  const skill = normalize(draft)

  if (!skill.SkillName || !skill.QueryTable) {
    return { query, skill: null, reasoning, sources, error: 'Could not produce a usable skill.' }
  }

  return { query, skill, reasoning, sources, error: null }
}
