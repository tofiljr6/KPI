/**
 * Offline check of the Markdown <-> string mapping (no LLM, no SAP).
 *
 *   node scripts/test-skill-markdown.js
 *
 * Verifies: render -> parse -> render is stable, and that the parser also
 * copes with hand-written documents (heading aliases, no numbering, free SQL).
 */
import assert from 'node:assert/strict'
import {
  renderSkillMarkdown,
  parseSkillMarkdown,
  validateSkillDoc,
  bumpVersion,
  compareVersions,
} from '../srv/lib/skillMarkdown.js'
import { toSkillInput, fromSkillInput } from '../srv/lib/skillAgent.js'

const doc = {
  name: 'GetBusinessPartnerAddress',
  description: 'Returns the address data of a business partner: city, street and postal code.',
  version: '1.0.0',
  lastUpdated: '2026-09-02',
  status: 'draft',
  purpose:
    'Answers questions about the **address of a business partner**.\n\n' +
    '- needs the partner number (`PARTNER`)\n' +
    '- does not return bank data or identification numbers',
  queries: [
    {
      name: 'Address number of the partner',
      description: 'Maps PARTNER to ADDRNUMBER. Needs {partner}.',
      table: 'but020',
      fields: ['partner', 'addrnumber', 'adr_kind'],
      whereClause: "PARTNER = '{partner}'",
    },
    {
      name: 'Address data',
      description: 'The address itself from ADRC, for the {addrnumber} of step 1.',
      table: 'ADRC',
      fields: ['ADDRNUMBER', 'NAME1', 'CITY1', 'POST_CODE1', 'STREET'],
      whereClause: "ADDRNUMBER = '{addrnumber}'",
    },
  ],
  returns:
    'One row per address:\n\n| Column | Meaning |\n|---|---|\n| CITY1 | City |\n| STREET | Street |\n\n' +
    'An empty result means the partner has no address.',
}

// 1. render -> parse -> render is stable
const md = renderSkillMarkdown(doc)
const parsed = parseSkillMarkdown(md)
assert.equal(renderSkillMarkdown(parsed), md, 'round-trip is not stable')
assert.deepEqual(validateSkillDoc(parsed), [], 'round-tripped doc does not validate')
assert.equal(parsed.name, doc.name)
assert.equal(parsed.status, 'draft')
assert.equal(parsed.lastUpdated, '2026-09-02')
assert.equal(parsed.queries.length, 2)
assert.equal(parsed.queries[0].table, 'BUT020')
assert.deepEqual(parsed.queries[1].fields, ['ADDRNUMBER', 'NAME1', 'CITY1', 'POST_CODE1', 'STREET'])
assert.equal(parsed.queries[1].whereClause, "ADDRNUMBER = '{addrnumber}'")

// 2. hand-written document: legacy PL/DE headings, no numbering, single-line SQL
const handWritten = `---
name: GetMaterialDescription
description: Returns the material description.
version: 2
last updated: 2026-01-15
status: active
---

# GetMaterialDescription

## Cel tego skilla

A short purpose.

## Zapytania

### Material description

No numbering, SQL on one line.

\`\`\`sql
select matnr, maktx from makt where matnr = '{matnr}' and spras = '{spras}'
\`\`\`

## Rückgabe

One row per language.
`
const hw = parseSkillMarkdown(handWritten)
assert.equal(hw.name, 'GetMaterialDescription')
assert.equal(hw.status, 'active')
assert.equal(hw.lastUpdated, '2026-01-15')
assert.equal(hw.purpose, 'A short purpose.')
assert.equal(hw.queries.length, 1)
assert.equal(hw.queries[0].name, 'Material description')
assert.equal(hw.queries[0].table, 'MAKT')
assert.deepEqual(hw.queries[0].fields, ['MATNR', 'MAKTX'])
// the WHERE clause is kept verbatim - uppercasing it would break {placeholders} and literals
assert.equal(hw.queries[0].whereClause, "matnr = '{matnr}' and spras = '{spras}'")
assert.equal(hw.returns, 'One row per language.')

// 3. re-rendering normalises legacy PL/DE headings into the English canonical form
const normalised = renderSkillMarkdown(hw)
assert.match(normalised, /^## Purpose$/m)
assert.match(normalised, /^## Query$/m)
assert.match(normalised, /^## Return$/m)
assert.doesNotMatch(normalised, /Cel tego skilla|Rückgabe/)
assert.match(normalised, /^### 1\. Material description$/m)
assert.equal(renderSkillMarkdown(parseSkillMarkdown(normalised)), normalised)

// 4. a document with no queries is reported, not silently accepted
assert.ok(validateSkillDoc({ name: 'X', description: 'y' }).some((p) => p.includes('Query')))

// 5. doc -> ABAP record -> doc (what actually crosses the wire)
const record = toSkillInput(doc, { trigger: 'Use this skill when the user asks for a partner address' })
assert.equal(record.SkillName, 'GetBusinessPartnerAddress')
assert.equal(record.SkillDescription, md, 'SkillDescription must be the full Markdown document')
assert.equal(record.SkillTriggerText, 'Use this skill when the user asks for a partner address')
assert.equal(record.QueryTable, 'BUT020', 'legacy Query* fields mirror the first query')
assert.equal(record.QueryFields, 'PARTNER, ADDRNUMBER, ADR_KIND')
assert.equal(record.QueryWhere, "PARTNER = '{partner}'")

const restored = fromSkillInput(record)
assert.equal(restored.markdown, md)
assert.equal(renderSkillMarkdown(restored.doc), md, 'record -> doc -> markdown is not stable')
assert.equal(restored.doc.queries[1].table, 'ADRC')
assert.equal(restored.trigger, record.SkillTriggerText)

// a legacy record with no Markdown at all still yields a usable (incomplete) doc
const legacy = fromSkillInput({ SkillName: 'OldSkill', SkillTriggerText: 'Use this skill when ...' })
assert.equal(legacy.doc.name, 'OldSkill')
assert.ok(validateSkillDoc(legacy.doc).length, 'legacy record should report missing sections')

// 6. version helpers – what a save/update relies on
assert.equal(bumpVersion('1.0.0'), '1.1.0')
assert.equal(bumpVersion('1.2.3', 'patch'), '1.2.4')
assert.equal(bumpVersion('2', 'major'), '3.0.0')
assert.equal(compareVersions('1.0.0', '1.1.0'), -1)
assert.equal(compareVersions('1.10.0', '1.9.0'), 1)
assert.equal(compareVersions('1.0', '1.0.0'), 0)

console.log(md)
console.log('--- all mapping tests passed')
