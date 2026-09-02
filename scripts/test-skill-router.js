/**
 * Offline check of the skill router (no LLM, no SAP).
 *
 *   node scripts/test-skill-router.js
 *
 * The model is stubbed, so what is verified here is the wiring around it: the tool
 * definitions the model gets to see, and how each possible answer is interpreted.
 * Whether the real model picks the right tool can only be checked with a live key —
 * see scripts/test-skill-routing-live.js.
 */
import assert from 'node:assert/strict'
import { skillToTool, routeQuestion } from '../srv/lib/skillRouter.js'
import { parseSkillMarkdown } from '../srv/lib/skillMarkdown.js'

const skillOf = (name, description, table, where) => ({
  SkillName: name,
  SkillTriggerText: `Use this skill when the user asks for ${description}`,
  doc: parseSkillMarkdown(`---
name: ${name}
description: ${description}
version: 1.0.0
last_updated: 2026-09-02
status: active
---

# ${name}

## Purpose

Returns ${description}.

## Query

### 1. Main query

\`\`\`sql
SELECT PARTNER, FIELD
  FROM ${table}
 WHERE ${where}
\`\`\`

## Return

One row.
`),
})

const skills = [
  skillOf('GetBusinessPartnerEmail', 'the email address of a business partner', 'ADR6', "PARTNER = '{partner}'"),
  skillOf('GetBusinessPartnerAddress', 'the postal address of a business partner', 'BUT020', "PARTNER = '{partner}'"),
  skillOf('GetMaterialDescription', 'the description of a material', 'MAKT', "MATNR = '{matnr}' AND SPRAS = '{spras}'"),
]

/** A stub standing in for ChatOpenAI: answers with the tool call it was told to make. */
const stubModel = (toolCall) => ({
  _seen: null,
  bindTools(tools, kwargs) {
    this._seen = { tools, kwargs }
    return this
  },
  async invoke() {
    return { tool_calls: toolCall ? [toolCall] : [] }
  },
})

// 1. the tool definition a skill turns into
const tool = skillToTool(skills[0])
assert.equal(tool.type, 'function')
assert.equal(tool.function.name, 'GetBusinessPartnerEmail')
assert.match(tool.function.description, /email address of a business partner/)
assert.match(tool.function.description, /Reads from: ADR6/)
assert.deepEqual(Object.keys(tool.function.parameters.properties), ['partner'])

const multi = skillToTool(skills[2])
assert.deepEqual(Object.keys(multi.function.parameters.properties).sort(), ['matnr', 'spras'])

// a chained multi-table skill only asks the caller for the first step's key –
// {addrnumber} is produced by step 1, not supplied by the user
const chained = {
  SkillName: 'GetBusinessPartnerCity',
  SkillTriggerText: 'Use this skill when the user asks for the city of a business partner',
  doc: parseSkillMarkdown(`---
name: GetBusinessPartnerCity
description: the city of a business partner
version: 1.0.0
last_updated: 2026-09-02
status: active
---

# GetBusinessPartnerCity

## Purpose
City of a partner.

## Query

### 1. Address number

\`\`\`sql
SELECT PARTNER, ADDRNUMBER
  FROM BUT020
 WHERE PARTNER = '{partner}'
\`\`\`

### 2. City

\`\`\`sql
SELECT ADDRNUMBER, CITY1
  FROM ADRC
 WHERE ADDRNUMBER = '{addrnumber}'
\`\`\`

## Return
One row with CITY1.
`),
}
assert.deepEqual(Object.keys(skillToTool(chained).function.parameters.properties), ['partner'])

// 2. the model is forced to choose, and sees every skill plus the escape hatch
const stub = stubModel({ name: 'GetBusinessPartnerEmail', args: { partner: '771' } })
const hit = await routeQuestion('I need the email address of partner 771', skills, { chat: stub })
assert.equal(stub._seen.kwargs.tool_choice, 'required', 'the model must be forced to call a tool')
assert.equal(stub._seen.tools.length, skills.length + 1, 'every skill plus no_matching_skill')
assert.ok(stub._seen.tools.some((t) => t.function.name === 'no_matching_skill'))
assert.equal(hit.matched, true)
assert.equal(hit.skill.SkillName, 'GetBusinessPartnerEmail')
assert.deepEqual(hit.parameters, [{ name: 'partner', value: '771' }])
assert.deepEqual(hit.missing, [])

// 3. a skill whose parameters are not all supplied reports what is still missing
const partial = await routeQuestion('describe material 4711', skills, {
  chat: stubModel({ name: 'GetMaterialDescription', args: { matnr: '4711', spras: '  ' } }),
})
assert.equal(partial.matched, true)
assert.deepEqual(partial.parameters, [{ name: 'matnr', value: '4711' }])
assert.deepEqual(partial.missing, ['spras'])

// 4. nothing fits -> not a match, with the model's reason
const none = await routeQuestion('what is the weather in Warsaw', skills, {
  chat: stubModel({ name: 'no_matching_skill', args: { missing: 'nothing here returns weather data' } }),
})
assert.equal(none.matched, false)
assert.equal(none.skill, null)
assert.match(none.reason, /weather/)

// 5. an empty repository never reaches the model at all
const empty = await routeQuestion('anything', [], { chat: stubModel(null) })
assert.equal(empty.matched, false)
assert.match(empty.reason, /no skills in the repository/i)

// 6. a hallucinated tool name is refused rather than passed off as a match
const bogus = await routeQuestion('anything', skills, {
  chat: stubModel({ name: 'GetSomethingInvented', args: {} }),
})
assert.equal(bogus.matched, false)
assert.match(bogus.reason, /not a stored skill/)

// 7. a model that answers with no tool call at all counts as "I do not know"
const silent = await routeQuestion('anything', skills, { chat: stubModel(null) })
assert.equal(silent.matched, false)

console.log('--- all router tests passed')
