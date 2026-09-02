/**
 * Offline check of the Markdown <-> string mapping (no LLM, no SAP).
 *
 *   node scripts/test-skill-markdown.js
 *
 * Verifies: render -> parse -> render is stable, and that the parser also
 * copes with hand-written documents (heading aliases, no numbering, free SQL).
 */
import assert from 'node:assert/strict'
import { renderSkillMarkdown, parseSkillMarkdown, validateSkillDoc } from '../srv/lib/skillMarkdown.js'
import { toSkillInput, fromSkillInput } from '../srv/lib/skillAgent.js'

const doc = {
  name: 'GetBusinessPartnerAddress',
  description: 'Zwraca dane adresowe partnera biznesowego: miasto, ulicę i kod pocztowy.',
  version: '1.0.0',
  lastUpdated: '2026-09-02',
  status: 'draft',
  purpose:
    'Skill odpowiada na pytania o **adres partnera biznesowego**.\n\n' +
    '- wymaga numeru partnera (`PARTNER`)\n' +
    '- nie zwraca danych bankowych ani identyfikatorów',
  queries: [
    {
      name: 'Numer adresu partnera',
      description: 'Mapuje PARTNER na ADDRNUMBER. Potrzebuje {partner}.',
      table: 'but020',
      fields: ['partner', 'addrnumber', 'adr_kind'],
      whereClause: "PARTNER = '{partner}'",
    },
    {
      name: 'Dane adresowe',
      description: 'Właściwy adres z ADRC, dla {addrnumber} z kroku 1.',
      table: 'ADRC',
      fields: ['ADDRNUMBER', 'NAME1', 'CITY1', 'POST_CODE1', 'STREET'],
      whereClause: "ADDRNUMBER = '{addrnumber}'",
    },
  ],
  returns:
    'Jeden wiersz na adres:\n\n| Pole | Znaczenie |\n|---|---|\n| CITY1 | Miasto |\n| STREET | Ulica |\n\n' +
    'Pusty wynik = partner nie ma adresu.',
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

// 2. hand-written document: EN/DE headings, no numbering, single-line SQL
const handWritten = `---
name: GetMaterialDescription
description: Zwraca opis materiału.
version: 2
last updated: 2026-01-15
status: active
---

# GetMaterialDescription

## Purpose

Krótki opis po polsku.

## Queries

### Opis materiału

Bez numeracji, SQL w jednej linii.

\`\`\`sql
select matnr, maktx from makt where matnr = '{matnr}' and spras = '{spras}'
\`\`\`

## Return

Jeden wiersz na język.
`
const hw = parseSkillMarkdown(handWritten)
assert.equal(hw.name, 'GetMaterialDescription')
assert.equal(hw.status, 'active')
assert.equal(hw.lastUpdated, '2026-01-15')
assert.equal(hw.purpose, 'Krótki opis po polsku.')
assert.equal(hw.queries.length, 1)
assert.equal(hw.queries[0].name, 'Opis materiału')
assert.equal(hw.queries[0].table, 'MAKT')
assert.deepEqual(hw.queries[0].fields, ['MATNR', 'MAKTX'])
// the WHERE clause is kept verbatim - uppercasing it would break {placeholders} and literals
assert.equal(hw.queries[0].whereClause, "matnr = '{matnr}' and spras = '{spras}'")
assert.equal(hw.returns, 'Jeden wiersz na język.')

// 3. re-rendering a hand-written doc normalises it into the canonical format
const normalised = renderSkillMarkdown(hw)
assert.match(normalised, /^## Cel tego skilla$/m)
assert.match(normalised, /^## Rückgabe$/m)
assert.match(normalised, /^### 1\. Opis materiału$/m)
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

console.log(md)
console.log('--- all mapping tests passed')
