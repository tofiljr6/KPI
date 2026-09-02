/**
 * Offline check of the skill executor (no SAP, no LLM).
 *
 *   node scripts/test-skill-executor.js
 *
 * Verifies the QuerySet payload a skill query turns into: comma-separated fields,
 * placeholder substitution, zero-padding of known key fields, and how the QuerySet
 * response is unwrapped back into rows.
 */
import assert from 'node:assert/strict'
import {
  buildQueryPayload,
  fillWhereClause,
  fieldForPlaceholder,
  normalizeIdValue,
  extractRows,
  harvestValues,
} from '../srv/lib/skillExecutor.js'
import { requiredPlaceholders } from '../srv/lib/skillMarkdown.js'

// 1. which field a placeholder is compared against
assert.equal(fieldForPlaceholder("PARTNER = '{partner}'", 'partner'), 'PARTNER')
assert.equal(fieldForPlaceholder("MATNR = '{matnr}' AND SPRAS = '{spras}'", 'spras'), 'SPRAS')
assert.equal(fieldForPlaceholder('NETWR > {amount}', 'amount'), 'NETWR')
assert.equal(fieldForPlaceholder("NAME1 LIKE '{name}'", 'name'), 'NAME1')

// 2. zero-padding: known key fields, purely numeric, only when shorter than the width
assert.equal(normalizeIdValue('PARTNER', '5'), '0000000005')
assert.equal(normalizeIdValue('partner', '0000000005'), '0000000005')
assert.equal(normalizeIdValue('KUNNR', '4711'), '0000004711')
assert.equal(normalizeIdValue('MATNR', '123'), '000000000000000123')
assert.equal(normalizeIdValue('SPRAS', 'E'), 'E', 'unknown field: untouched')
assert.equal(normalizeIdValue('PARTNER', 'ABC123'), 'ABC123', 'non-numeric: untouched')

// 3. WHERE clause fill
assert.equal(fillWhereClause("PARTNER = '{partner}'", { partner: '5' }), "PARTNER = '0000000005'")
assert.equal(fillWhereClause("PARTNER = '{partner}'", {}), "PARTNER = '{partner}'", 'no value: token kept')
assert.equal(fillWhereClause("NAME1 = '{name}'", { name: "O'Brien" }), "NAME1 = 'O''Brien'", 'quote escaped')
assert.equal(
  fillWhereClause("MATNR = '{matnr}' AND SPRAS = '{spras}'", { matnr: '42', spras: 'E' }),
  "MATNR = '000000000000000042' AND SPRAS = 'E'"
)

// 4. the full payload: fields separated by ", " (the backend needs the space),
//    table upper-cased
assert.deepEqual(
  buildQueryPayload(
    { table: 'but000', fields: ['PARTNER', 'TYPE', 'BU_GROUP'], whereClause: "PARTNER = '{partner}'" },
    { partner: '5' },
    { maxRows: 10 }
  ),
  { TableName: 'BUT000', Fields: 'PARTNER, TYPE, BU_GROUP', WhereClause: "PARTNER = '0000000005'", MaxRows: 10 }
)

// 5. MaxRows is left out unless it is a positive integer
assert.equal('MaxRows' in buildQueryPayload({ table: 'T', fields: ['A'], whereClause: '' }, {}), false)
assert.equal('MaxRows' in buildQueryPayload({ table: 'T', fields: ['A'], whereClause: '' }, {}, { maxRows: 0 }), false)

// 6. extractRows: the QuerySet `result` field is a JSON string of rows
assert.deepEqual(
  extractRows(JSON.stringify({ d: { TableNmae: 'BUT0ID', result: '[{"TYPE":"PL","IDNUMBER":"123"}]' } })),
  [{ TYPE: 'PL', IDNUMBER: '123' }]
)
assert.deepEqual(extractRows(JSON.stringify({ d: { result: '[]' } })), [])
assert.deepEqual(extractRows(JSON.stringify({ d: { result: '' } })), [], 'empty result string')
assert.deepEqual(
  extractRows(JSON.stringify({ d: { result: '{"TYPE":"PL"}' } })),
  [{ TYPE: 'PL' }],
  'result holding a single object'
)

// ...and still falls back to the OData V2 feed shape, dropping __metadata
assert.deepEqual(
  extractRows(JSON.stringify({ d: { results: [{ __metadata: { uri: 'x' }, PARTNER: '0000000005', TYPE: '1' }] } })),
  [{ PARTNER: '0000000005', TYPE: '1' }]
)
assert.deepEqual(extractRows('{"d":{"results":[]}}'), [])
assert.deepEqual(extractRows(JSON.stringify({ d: { PARTNER: '1' } })), [{ PARTNER: '1' }], 'single entity')
assert.deepEqual(extractRows('not json'), [])

// 7. multi-step: harvestValues takes the first row, lowercases the keys
assert.deepEqual(
  harvestValues([{ PARTNER: '0000000006', ADDRNUMBER: '0000012345' }, { PARTNER: '0000000006', ADDRNUMBER: '0000099999' }]),
  { partner: '0000000006', addrnumber: '0000012345' }
)
assert.deepEqual(harvestValues([]), {}, 'no rows -> nothing to chain')
assert.deepEqual(harvestValues([{ A: '', B: null, C: 'x' }]), { c: 'x' }, 'blank values skipped')

// 8. requiredPlaceholders: only what the caller supplies; a chained step's key is excluded
const addressSkill = {
  queries: [
    { table: 'BUT020', fields: ['PARTNER', 'ADDRNUMBER'], whereClause: "PARTNER = '{partner}'" },
    { table: 'ADRC', fields: ['ADDRNUMBER', 'CITY1'], whereClause: "ADDRNUMBER = '{addrnumber}'" },
  ],
}
assert.deepEqual(requiredPlaceholders(addressSkill), ['partner'], '{addrnumber} comes from step 1')

const twoParamSkill = {
  queries: [{ table: 'MAKT', fields: ['MATNR', 'MAKTX'], whereClause: "MATNR = '{matnr}' AND SPRAS = '{spras}'" }],
}
assert.deepEqual(requiredPlaceholders(twoParamSkill).sort(), ['matnr', 'spras'])

console.log('--- all executor tests passed')
