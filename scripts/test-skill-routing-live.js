/**
 * Live check of the skill router against the real model (no SAP needed).
 *
 *   node --env-file=.env scripts/test-skill-routing-live.js
 *   node --env-file=.env scripts/test-skill-routing-live.js "your own question"
 *
 * Uses a small fixed set of skills, so what it measures is the routing behaviour
 * itself: does the model pick the right skill, extract the identifier, and refuse
 * to answer when nothing covers the request.
 *
 * .env needs OPENAI_API_KEY.
 */
import { routeQuestion } from '../srv/lib/skillRouter.js'
import { parseSkillMarkdown } from '../srv/lib/skillMarkdown.js'

const skill = (name, description, table, where) => ({
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
SELECT * FROM ${table} WHERE ${where}
\`\`\`

## Return

One row per hit.
`),
})

const skills = [
  skill('GetBusinessPartnerEmail', 'the email address of a business partner', 'ADR6', "PARTNER = '{partner}'"),
  skill('GetBusinessPartnerAddress', 'the postal address of a business partner', 'BUT020', "PARTNER = '{partner}'"),
  skill('GetMaterialDescription', 'the description of a material', 'MAKT', "MATNR = '{matnr}' AND SPRAS = '{spras}'"),
]

// expected: the skill that should win, or null when nothing may match
const cases = process.argv[2]
  ? [[process.argv[2], undefined]]
  : [
      ['I would like the email address of partner 771', 'GetBusinessPartnerEmail'],
      ['chciałbym dostać adres email partnera numer 771', 'GetBusinessPartnerEmail'],
      ['what is the street and city of business partner 4711', 'GetBusinessPartnerAddress'],
      ['give me the description of material M-100 in English', 'GetMaterialDescription'],
      // nothing stored covers these – the router must say so instead of answering
      ['what is the phone number of partner 771', null],
      ['which bank account does partner 771 use', null],
      ['what is the capital of France', null],
      ['list the sales orders created last week', null],
    ]

let failures = 0
for (const [question, expected] of cases) {
  const result = await routeQuestion(question, skills)
  const got = result.matched ? result.skillName || result.skill?.SkillName : null
  const params = result.parameters.map((p) => `${p.name}=${p.value}`).join(', ') || '—'
  const ok = expected === undefined || got === expected
  if (!ok) failures++

  console.log(`${ok ? '✓' : '✗'} ${question}`)
  console.log(`   → ${got ? `${got}  [${params}]` : `no match: ${result.reason}`}`)
  if (!ok) console.log(`   expected: ${expected ?? 'no match'}`)
  if (result.missing?.length) console.log(`   missing: ${result.missing.join(', ')}`)
}

if (process.argv[2]) process.exit(0)
console.log(failures ? `\n${failures} of ${cases.length} routed wrongly` : `\nall ${cases.length} routed correctly`)
process.exit(failures ? 1 : 0)
