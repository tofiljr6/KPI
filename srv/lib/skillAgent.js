import { z } from 'zod'
import { model } from './model.js'
import {
  renderSkillMarkdown,
  parseSkillMarkdown,
  normalizeSkillDoc,
  validateSkillDoc,
  placeholdersOf,
  todayStamp,
} from './skillMarkdown.js'

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
  'Given a data request, plan how to answer it with plain OpenSQL SELECTs on SAP standard',
  'transparent tables. Pick the ONE primary table, then lay out 1-4 steps: each step is a',
  'single SELECT on one table (no JOINs, no sub-selects). Use extra steps when the data is',
  'reached through a mapping table (e.g. BUT020 gives ADDRNUMBER, then ADRC gives the address)',
  'or when clearly related detail belongs to the same skill. Do not pad: one step is fine.',
  'Later steps may consume a value produced by an earlier step - say so in dependsOn.',
  'Use only real SAP technical names.',
].join('\n')

const SKILL_SYSTEM = [
  'You write skill documents: reusable instructions telling a downstream agent how to pull',
  'one kind of data out of SAP. You are given a table plan; turn it into a structured skill.',
  '',
  'Rules:',
  '- name: PascalCase, no spaces, verb-first, e.g. GetBusinessPartnerAddress.',
  '- description: ONE sentence, states what data comes back. No trailing period-less fragments.',
  '- trigger: starts with "Use this skill when the user asks for ...".',
  '- purpose: 2-5 sentences or bullets - what question this answers, what it does NOT cover,',
  '  and which identifier the caller must have. Markdown allowed (bold, bullets).',
  '- queries: one entry per step of the plan, in execution order. Each has a short human name,',
  '  a one-or-two sentence description (including which placeholder it needs and, if it depends',
  '  on an earlier step, where that value comes from), the table, the fields, and a WHERE clause',
  '  using {placeholder} tokens, e.g. "PARTNER = \'{partner}\'". Placeholder names are lowercase',
  '  and match the field they filter. Never invent field names.',
  '- returns: describe the result shape - a Markdown table of the returned columns with a short',
  '  meaning for each, plus one line on cardinality (one row / many rows) and what an empty',
  '  result means.',
  '',
  'Write name, table and field names in technical SAP form (UPPERCASE). Write ALL prose',
  '(description, trigger, purpose, query descriptions, returns) in ENGLISH, whatever language',
  'the data request itself is in.',
].join('\n')

const REVISE_SYSTEM = [
  'You revise an existing SAP skill document. You are given the current document and one',
  'change request. Return the COMPLETE updated document, not a diff.',
  '',
  'Rules:',
  '- Apply only what the change request asks for. Everything it does not touch stays',
  '  byte-for-byte as it was - same wording, same queries, same field order.',
  '- Keep the name unless renaming is explicitly requested.',
  '- Use real SAP technical names (UPPERCASE) and keep {placeholder} tokens intact.',
  '- If the request is impossible (a field that does not exist on that table, a table that',
  '  does not hold that data), return the document unchanged and say so in `reasoning`.',
  '- All prose stays in ENGLISH.',
].join('\n')

const planSchema = z.object({
  table: z.string().describe('The ONE primary SAP standard transparent table, UPPERCASE'),
  keyField: z.string().describe('The field used to filter the primary table (e.g. PARTNER, MATNR)'),
  candidateFields: z.array(z.string()).describe('Technical field names worth selecting from the primary table'),
  confidence: z.enum(['high', 'medium', 'low']),
  alternatives: z.array(z.string()).describe('Other plausible tables, UPPERCASE'),
  notes: z.string().describe('1-2 sentences: why this table'),
  steps: z
    .array(
      z.object({
        purpose: z.string().describe('What this single SELECT contributes'),
        table: z.string().describe('SAP table for this step, UPPERCASE'),
        keyField: z.string().describe('Field this step filters on'),
        fields: z.array(z.string()).describe('Technical field names to select'),
        dependsOn: z
          .string()
          .describe('Field from an earlier step feeding this one, or empty string if none'),
      })
    )
    .min(1)
    .max(4)
    .describe('1-4 single-table SELECT steps, in execution order'),
})

const docSchema = z.object({
  name: z.string().describe('PascalCase skill name, e.g. GetBusinessPartnerAddress'),
  description: z.string().describe('One sentence: what data this skill returns'),
  trigger: z.string().describe('Starts with "Use this skill when the user asks for ..."'),
  purpose: z.string().describe('Markdown prose for the "Purpose" section'),
  queries: z
    .array(
      z.object({
        name: z.string().describe('Short human-readable name of this query'),
        description: z.string().describe('1-2 sentences: what it returns and which placeholder it needs'),
        table: z.string().describe('SAP table, UPPERCASE'),
        fields: z.array(z.string()).describe('Real technical field names of that table'),
        whereClause: z.string().describe("WHERE clause with {placeholder} tokens, without the WHERE keyword"),
      })
    )
    .min(1)
    .max(4),
  returns: z.string().describe('Markdown prose for the "Return" section, incl. a column table'),
  reasoning: z.string().describe('1-2 sentences on the table/field choice'),
})

/** Skill document -> the flat SkillInput payload posted to ABAP. */
export function toSkillInput(doc, { trigger = '', markdown } = {}) {
  const d = normalizeSkillDoc(doc)
  const primary = d.queries[0] || {}
  return {
    SkillName: d.name,
    // The whole Markdown document lives here - see docs/skill-markdown.md.
    SkillDescription: markdown || renderSkillMarkdown(d),
    SkillTriggerText: String(trigger || d.description || '').trim(),
    QueryTable: primary.table || '',
    QueryFields: (primary.fields || []).join(', '),
    QueryWhere: primary.whereClause || '',
  }
}

/** The inverse: a stored ABAP record -> skill document + trigger text. */
export function fromSkillInput(record) {
  const markdown = record?.SkillDescription || ''
  return {
    markdown,
    doc: markdown
      ? parseSkillMarkdown(markdown)
      : normalizeSkillDoc({ name: record?.SkillName, description: record?.SkillTriggerText }),
    trigger: record?.SkillTriggerText || '',
  }
}

/**
 * An existing document + a change request -> the revised document.
 * `options.version` / `options.status` override what the current document carries
 * (the chat service bumps the version when the source skill is already stored).
 */
export async function runSkillRevision(markdown, instruction, options = {}) {
  const current = parseSkillMarkdown(markdown)

  const draft = await model()
    .withStructuredOutput(docSchema)
    .invoke([
      { role: 'system', content: `${DATAMODEL_SYSTEM}\n\n---\n\n${REVISE_SYSTEM}` },
      {
        role: 'user',
        content: `Current skill document:\n\n${markdown}\n\nChange request: ${instruction}`,
      },
    ])

  const doc = normalizeSkillDoc({
    name: draft.name || current.name,
    description: draft.description || current.description,
    version: options.version || current.version,
    lastUpdated: options.lastUpdated || todayStamp(),
    status: options.status || current.status,
    purpose: draft.purpose,
    queries: draft.queries,
    returns: draft.returns,
  })

  const problems = validateSkillDoc(doc)
  const markdownOut = renderSkillMarkdown(doc)
  const parameters = [...new Set(doc.queries.flatMap((q) => placeholdersOf(q)))]

  return {
    instruction,
    markdown: markdownOut,
    doc,
    parameters,
    trigger: draft.trigger || '',
    reasoning: draft.reasoning || null,
    error: problems.length ? `Revised skill is incomplete: ${problems.join('; ')}` : null,
  }
}

/**
 * Natural-language data request -> skill document (Markdown) + ABAP payload.
 * 1. plan  : an SAP-data-model chat lays out the table(s) and 1-4 SELECT steps.
 * 2. draft : turns that plan into the skill document (metadata, purpose, queries, returns).
 */
export async function runSkillAgent(query, options = {}) {
  const plan = await model()
    .withStructuredOutput(planSchema)
    .invoke([
      { role: 'system', content: DATAMODEL_SYSTEM },
      { role: 'user', content: `Data request: ${query}` },
    ])

  const draft = await model()
    .withStructuredOutput(docSchema)
    .invoke([
      { role: 'system', content: SKILL_SYSTEM },
      {
        role: 'user',
        content:
          `Data request: ${query}\n\n` +
          `Primary table: ${plan.table} (key: ${plan.keyField}, confidence: ${plan.confidence})\n` +
          `Candidate fields: ${plan.candidateFields.join(', ')}\n` +
          `Notes: ${plan.notes}\n\n` +
          `Steps:\n` +
          plan.steps
            .map(
              (s, i) =>
                `${i + 1}. ${s.table} (key ${s.keyField}${s.dependsOn ? `, needs ${s.dependsOn} from an earlier step` : ''})` +
                ` fields: ${s.fields.join(', ')} - ${s.purpose}`
            )
            .join('\n'),
      },
    ])

  const doc = normalizeSkillDoc({
    name: draft.name,
    description: draft.description,
    version: options.version || '1.0.0',
    lastUpdated: options.lastUpdated,
    status: options.status || 'draft',
    purpose: draft.purpose,
    queries: draft.queries,
    returns: draft.returns,
  })

  const problems = validateSkillDoc(doc)
  const markdown = renderSkillMarkdown(doc)
  const tableChoice = {
    table: plan.table,
    keyField: plan.keyField,
    candidateFields: plan.candidateFields,
    confidence: plan.confidence,
    alternatives: plan.alternatives,
    notes: plan.notes,
  }
  const parameters = [...new Set(doc.queries.flatMap((q) => placeholdersOf(q)))]

  if (problems.length) {
    return {
      query,
      skill: null,
      markdown,
      doc,
      parameters,
      reasoning: draft.reasoning || null,
      tableChoice,
      error: `Generated skill is incomplete: ${problems.join('; ')}`,
    }
  }

  return {
    query,
    skill: toSkillInput(doc, { trigger: draft.trigger, markdown }),
    markdown,
    doc,
    parameters,
    reasoning: draft.reasoning || null,
    tableChoice,
    error: null,
  }
}
