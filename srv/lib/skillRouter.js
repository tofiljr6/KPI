import { model } from './model.js'

/**
 * Skill routing: which stored skill answers a question?
 *
 * Every skill in the repository becomes a tool. The model is forced to call exactly
 * one of them (`tool_choice: 'required'`), and one of the tools is an explicit
 * "none of these fit" — so the model can never fall back on its own SAP knowledge
 * and answer the question itself. It either points at a stored skill or says it
 * does not know.
 *
 * Executing the skill (running the SELECT) is a later step; this only picks one.
 */

const NO_MATCH = 'no_matching_skill'

const ROUTER_SYSTEM = [
  'You route a data request to exactly ONE stored skill. Each tool is one skill that',
  'somebody has already written; the tool description says what data it returns.',
  '',
  'Hard rules:',
  `- Your ONLY knowledge is the tool list. You know nothing else about SAP, its tables`,
  '  or its data. Never answer the request yourself, never invent a table or a field.',
  '- Pick a skill ONLY if it actually returns the data that was asked for. A skill about',
  '  a related topic (same entity, different data) is NOT a match.',
  `- If no tool returns the requested data, call ${NO_MATCH} and say what is missing.`,
  '  Doing that is the correct answer, not a failure.',
  '- Fill a parameter only with a value that appears in the request. Never guess or',
  '  invent an identifier; leave unknown parameters out.',
].join('\n')

/** OpenAI tool names allow [a-zA-Z0-9_-]{1,64}. */
const toolName = (name) =>
  String(name || '')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 64) || 'skill'

const truncate = (text, max) => {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  return value.length > max ? value.slice(0, max - 1) + '…' : value
}

/** Every {placeholder} the skill's queries need, as tool parameters. */
function parametersOf(doc) {
  const tokens = new Set()
  for (const query of doc?.queries || []) {
    const source = `${query.whereClause || ''} ${query.sql || ''}`
    for (const match of source.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) tokens.add(match[1])
  }
  return [...tokens]
}

/** One stored skill -> one OpenAI tool definition. */
export function skillToTool(skill) {
  const doc = skill.doc || {}
  const tables = [...new Set((doc.queries || []).map((q) => q.table).filter(Boolean))]
  const description = [
    truncate(doc.description || skill.SkillTriggerText, 300),
    skill.SkillTriggerText ? `Use when: ${truncate(skill.SkillTriggerText, 200)}` : '',
    doc.purpose ? `Details: ${truncate(doc.purpose, 400)}` : '',
    tables.length ? `Reads from: ${tables.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const properties = {}
  for (const parameter of parametersOf(doc)) {
    properties[parameter] = {
      type: 'string',
      description: `Value for {${parameter}}, taken verbatim from the request. Omit if not stated.`,
    }
  }

  return {
    type: 'function',
    function: {
      name: toolName(skill.SkillName || doc.name),
      description: description || 'A stored skill.',
      parameters: { type: 'object', properties, required: [] },
    },
  }
}

const noMatchTool = {
  type: 'function',
  function: {
    name: NO_MATCH,
    description:
      'Call this when none of the other tools returns the data that was requested. ' +
      'This is the right answer whenever the request is not covered by a stored skill.',
    parameters: {
      type: 'object',
      properties: {
        missing: {
          type: 'string',
          description: 'What data the request needs that no stored skill provides, in one sentence.',
        },
      },
      required: ['missing'],
    },
  },
}

/**
 * Question + the stored skills -> the one skill that answers it.
 * Returns `{ matched: false }` with a reason when nothing fits (including an empty
 * repository); never returns an answer produced from the model's own knowledge.
 *
 * `options.chat` replaces the LLM (used by scripts/test-skill-router.js).
 */
export async function routeQuestion(question, skills, options = {}) {
  const usable = (skills || []).filter((s) => s && (s.SkillName || s.doc?.name))

  if (!usable.length) {
    return {
      question,
      matched: false,
      skill: null,
      parameters: [],
      missing: [],
      reason: 'There are no skills in the repository yet, so there is nothing I can use.',
    }
  }

  const tools = usable.map(skillToTool)
  const chat = options.chat || model()
  const response = await chat
    .bindTools([...tools, noMatchTool], { tool_choice: 'required' })
    .invoke([
      { role: 'system', content: ROUTER_SYSTEM },
      { role: 'user', content: `Data request: ${question}` },
    ])

  const call = (response.tool_calls || [])[0]
  if (!call || call.name === NO_MATCH) {
    return {
      question,
      matched: false,
      skill: null,
      parameters: [],
      missing: [],
      reason:
        call?.args?.missing ||
        'No stored skill returns the data this request asks for.',
    }
  }

  const chosen =
    usable.find((s) => toolName(s.SkillName || s.doc?.name) === call.name) || null
  if (!chosen) {
    return {
      question,
      matched: false,
      skill: null,
      parameters: [],
      missing: [],
      reason: `The model picked "${call.name}", which is not a stored skill.`,
    }
  }

  const expected = parametersOf(chosen.doc)
  const provided = Object.entries(call.args || {})
    .filter(([, value]) => String(value ?? '').trim())
    .map(([name, value]) => ({ name, value: String(value).trim() }))

  return {
    question,
    matched: true,
    skill: chosen,
    parameters: provided,
    missing: expected.filter((p) => !provided.some((v) => v.name === p)),
    reason: '',
  }
}
