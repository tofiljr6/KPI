import { z } from 'zod'
import { model } from './model.js'

const DATAMODEL_SYSTEM = [
  'You are a senior SAP data-model expert across all modules (SD, MM, FI/CO, HCM/HR, PP,',
  'WM/EWM, PM, PS, BP/BDT, CS, QM, ...). You know SAP application tables and their real',
  'technical field names in depth.',
  '',
  'Reference examples (non-exhaustive):',
  '- Business Partner: BUT000, BUT020 (PARTNER->ADDRNUMBER), BUT021_FS, ADRC, ADR2/ADR3/ADR6, BUT0ID, BUT0BK, BUT100',
  '- Material (MM): MARA, MARC, MAKT, MBEW, MARD, MVKE',
  '- Sales (SD): VBAK, VBAP, VBRK, VBRP, LIKP, LIPS, KNA1, KNVV',
  '- Purchasing (MM): EKKO, EKPO, EKBE, LFA1, LFB1',
  '- Finance (FI): BKPF, BSEG, BSID, BSIK, SKA1, SKB1, FAGLFLEXA',
  '- Controlling (CO): COEP, COBK, CSKS, CSKT',
  '- HCM (HR): PA0001, PA0002, PA0006, PA0105, HRP1000',
  '',
  'Given a data request, identify the ONE SAP standard transparent table that best holds that data',
  '(the skill will run a single OpenSQL SELECT on it). Report the key field to filter by, the',
  'candidate fields to select, your confidence, and plausible alternative tables.',
  'Use only real SAP technical names. If a piece of data lives behind an address number, pick the',
  'table the caller can actually query with the identifier they will have.',
].join('\n')

const SKILL_SYSTEM = [
  'You turn a chosen SAP table into a skill definition executed as a single OpenSQL SELECT.',
  '- QueryTable: the given table, UPPERCASE technical name.',
  '- QueryFields: comma-separated real technical field names of that table.',
  "- QueryWhere: a WHERE clause using {placeholder} tokens for runtime values,",
  "  e.g. \"PARTNER = '{partner}'\" or \"MATNR = '{matnr}'\".",
  '- Never invent field names; stick to the ones provided / known for that table.',
].join('\n')

const tableChoiceSchema = z.object({
  table: z.string().describe('ONE SAP standard transparent table, UPPERCASE technical name'),
  keyField: z.string().describe('The field used to filter (e.g. PARTNER, MATNR, ADDRNUMBER)'),
  candidateFields: z.array(z.string()).describe('Technical field names worth selecting from that table'),
  confidence: z.enum(['high', 'medium', 'low']),
  alternatives: z.array(z.string()).describe('Other plausible tables, UPPERCASE'),
  notes: z.string().describe('1-2 sentences: why this table'),
})

const skillSchema = z.object({
  SkillName: z.string().describe('PascalCase, no spaces, e.g. GetBusinessPartnerAddress'),
  SkillDescription: z.string().describe('One sentence: what data this skill returns'),
  SkillTriggerText: z.string().describe('Starts with "Use this skill when the user asks for ..."'),
  QueryTable: z.string(),
  QueryFields: z.string().describe('Comma-separated real technical field names'),
  QueryWhere: z.string().describe("WHERE clause with {placeholder} tokens"),
  reasoning: z.string().describe('1-2 sentences on the field/WHERE choice'),
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
 * Natural-language data request -> skill definition in SkillInput shape.
 * 1. findSapTable : a dedicated SAP-data-model chat picks the ONE table + fields.
 * 2. draft        : turn that choice into the createSkill payload.
 */
export async function runSkillAgent(query) {
  const tableChoice = await model()
    .withStructuredOutput(tableChoiceSchema)
    .invoke([
      { role: 'system', content: DATAMODEL_SYSTEM },
      { role: 'user', content: `Data request: ${query}` },
    ])

  const draft = await model()
    .withStructuredOutput(skillSchema)
    .invoke([
      { role: 'system', content: SKILL_SYSTEM },
      {
        role: 'user',
        content:
          `Data request: ${query}\n\n` +
          `Chosen table: ${tableChoice.table}\n` +
          `Key field: ${tableChoice.keyField}\n` +
          `Candidate fields: ${tableChoice.candidateFields.join(', ')}\n` +
          `Notes: ${tableChoice.notes}`,
      },
    ])

  const reasoning = draft.reasoning || null
  const skill = normalize({ ...draft, QueryTable: draft.QueryTable || tableChoice.table })

  if (!skill.SkillName || !skill.QueryTable) {
    return { query, skill: null, reasoning, tableChoice, error: 'Could not produce a usable skill.' }
  }

  return { query, skill, reasoning, tableChoice, error: null }
}
