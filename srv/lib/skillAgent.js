import { AgentExecutor, createToolCallingAgent } from 'langchain/agents'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { z } from 'zod'
import { model } from './model.js'
import { searchWebTool } from './searchTool.js'

const tools = [searchWebTool]

const prompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    [
      'You build SAP ABAP data-extraction skills.',
      'The user describes what data they want (e.g. "address data of a business partner").',
      '',
      'Your job:',
      '1. Use the `search_web` tool to research the relevant SAP standard table(s) and their',
      '   technical field names. For business partner data, investigate the SAP Business Partner',
      '   data model (tables such as BUT000, BUT020, BUT021_FS, BUT0ID, ADRC, ADR2, ADR6, ...).',
      '   Run more than one search if needed to confirm table and field names.',
      '2. Decide on ONE transparent table that best serves the request.',
      '3. Produce the skill definition.',
      '',
      'The skill is executed as a single OpenSQL SELECT on that ONE table, so:',
      '- QueryTable: exactly one SAP standard table, technical name, UPPERCASE.',
      '- QueryFields: comma-separated technical field names that exist on that table.',
      "- QueryWhere: a WHERE clause using {{placeholder}} tokens for runtime values,",
      "  e.g. \"PARTNER = '{{partner}}'\".",
      '- Never invent field names.',
      '',
      'When done, reply with ONLY a JSON object, no prose, no code fences:',
      '{{"SkillName":"PascalCaseNoSpaces","SkillDescription":"one sentence",',
      '"SkillTriggerText":"Use this skill when the user asks for ...",',
      '"QueryTable":"TABLE","QueryFields":"F1, F2, F3","QueryWhere":"F1 = \'{{token}}\'",',
      '"reasoning":"1-2 sentences on the table/field choice"}}',
    ].join('\n'),
  ],
  ['human', '{input}'],
  ['placeholder', '{agent_scratchpad}'],
])

const skillSchema = z.object({
  SkillName: z.string(),
  SkillDescription: z.string(),
  SkillTriggerText: z.string(),
  QueryTable: z.string(),
  QueryFields: z.string(),
  QueryWhere: z.string(),
  reasoning: z.string(),
})

function tryParseJson(text) {
  if (!text) return null
  const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

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
 * LangChain tool-calling agent. Researches the SAP data model with `search_web`,
 * then returns the skill in SkillsService.createSkill shape.
 */
export async function runSkillAgent(query) {
  const llm = model()

  const agent = createToolCallingAgent({ llm, tools, prompt })
  const executor = new AgentExecutor({ agent, tools, maxIterations: 6, returnIntermediateSteps: true })

  const run = await executor.invoke({ input: query })

  const sources = []
  for (const [action, observation] of run.intermediateSteps || []) {
    if (action?.tool !== 'search_web') continue
    try {
      for (const r of JSON.parse(observation).results || []) {
        sources.push({ title: r.title, url: r.url })
      }
    } catch { /* ignore */ }
  }

  let parsed = tryParseJson(run.output)

  // Fallback: coerce whatever the agent said into the schema with one more call.
  if (!parsed || !parsed.QueryTable) {
    const coerce = model().withStructuredOutput(skillSchema)
    parsed = await coerce.invoke([
      { role: 'system', content: 'Extract the skill definition as structured data.' },
      { role: 'user', content: run.output || query },
    ])
  }

  const reasoning = parsed.reasoning || null
  const skill = normalize(parsed)

  if (!skill.SkillName || !skill.QueryTable) {
    return { query, skill: null, reasoning, sources, error: 'Agent did not produce a usable skill.' }
  }

  return { query, skill, reasoning, sources, error: null }
}
