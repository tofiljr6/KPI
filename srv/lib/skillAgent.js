import { z } from 'zod'
import { model } from './model.js'

const EXPERT_SYSTEM = [
  'You are a senior SAP expert for the Business Partner (BP) / Business Data Toolset (BDT) module.',
  'You know the SAP BP data model in depth. Reference tables (non-exhaustive):',
  '- BUT000  : BP general data (PARTNER, TYPE, BU_GROUP, NAME_ORG1/2, NAME_FIRST, NAME_LAST, ...)',
  '- BUT020  : BP address usages – links PARTNER to ADDRNUMBER (PARTNER, ADDRNUMBER, XDFADR, ...)',
  '- BUT021_FS: BP address usage / validity (PARTNER, ADDRNUMBER, ADR_KIND, DATE_FROM, DATE_TO)',
  '- ADRC    : central address data (ADDRNUMBER, NAME1, CITY1, POST_CODE1, STREET, HOUSE_NUM1, COUNTRY, REGION, ...)',
  '- ADR2 / ADR3 : phone / fax numbers (ADDRNUMBER, TEL_NUMBER, ...)',
  '- ADR6    : e-mail addresses (ADDRNUMBER, SMTP_ADDR, ...)',
  '- BUT0ID  : BP identification numbers (PARTNER, TYPE, IDNUMBER, VALID_DATE_FROM, VALID_DATE_TO)',
  '- BUT0BK  : BP bank details (PARTNER, BANKS, BANKL, BANKN, ...)',
  '- BUT100  : BP roles (PARTNER, RLTYP, ...)',
  '',
  'Rules for the skill you produce:',
  '- The skill runs as a SINGLE OpenSQL SELECT on exactly ONE transparent table.',
  '- QueryTable MUST be a table from the SAP Business Partner domain (BUT*, ADRC, ADR2/3/6). Nothing else.',
  '- Never use invented or non-SAP table/field names.',
  '- QueryFields: comma-separated real technical field names of that table.',
  "- QueryWhere: a WHERE clause using {placeholder} tokens for runtime values, e.g. \"PARTNER = '{partner}'\".",
  '- If the request needs data behind an address number (address, phone, e-mail) and the caller',
  "  has a partner number, prefer BUT020 (PARTNER -> ADDRNUMBER); if the request clearly wants the",
  '  concrete address fields, use ADRC keyed by ADDRNUMBER.',
].join('\n')

const skillSchema = z.object({
  SkillName: z.string().describe('PascalCase, no spaces, e.g. GetBusinessPartnerAddress'),
  SkillDescription: z.string().describe('One sentence: what data this skill returns'),
  SkillTriggerText: z.string().describe('Starts with "Use this skill when the user asks for ..."'),
  QueryTable: z.string().describe('ONE SAP Business Partner table, UPPERCASE (BUT000/BUT020/ADRC/ADR6/BUT0ID/...)'),
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
 * Single LangChain structured-output call with the SAP BP expert system prompt.
 */
export async function runSkillAgent(query) {
  const draft = await model().withStructuredOutput(skillSchema).invoke([
    { role: 'system', content: EXPERT_SYSTEM },
    { role: 'user', content: `Data request: ${query}` },
  ])

  const reasoning = draft.reasoning || null
  const skill = normalize(draft)

  if (!skill.SkillName || !skill.QueryTable) {
    return { query, skill: null, reasoning, error: 'Could not produce a usable skill.' }
  }

  return { query, skill, reasoning, error: null }
}
