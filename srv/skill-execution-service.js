import cds from '@sap/cds'
import { placeholdersOf } from './lib/skillMarkdown.js'
import { buildQueryPayload, extractRows } from './lib/skillExecutor.js'
import { queryRequestBody } from './lib/abapQuery.js'
import { formatSkillAnswer } from './lib/skillAnswer.js'

/** A fully-populated SkillRun, so every branch returns the same shape. */
const runShape = (extra = {}) => ({
  skillName: '',
  ran: false,
  table: '',
  fields: '',
  whereClause: '',
  maxRows: null,
  requestJson: '',
  rowCount: 0,
  columns: [],
  rowsJson: '[]',
  answer: '',
  missing: [],
  error: null,
  ...extra,
})

export default cds.service.impl(function () {

  const repository = () => cds.connect.to('SkillRepositoryService')

  this.on('runSkill', async (req) => {
    const { question, skillName } = req.data
    const parameters = req.data.parameters || []
    const maxRows = Number.isInteger(req.data.maxRows) && req.data.maxRows > 0 ? req.data.maxRows : undefined
    if (!skillName || !skillName.trim()) return req.error(400, 'Missing "skillName"')

    let stored
    try {
      stored = await (await repository()).send('getSkillDoc', { id: skillName })
    } catch (err) {
      console.error('runSkill: could not load skill', err)
      return req.error(err?.response?.status || 500, err.message)
    }

    const query = stored?.doc?.queries?.[0]
    if (!query || !query.table) {
      return runShape({ skillName, error: `Skill "${skillName}" has no runnable query.` })
    }

    // Only values that actually carry something count as "provided".
    const values = Object.fromEntries(
      parameters
        .filter((p) => p && p.name && String(p.value ?? '').trim())
        .map((p) => [p.name, String(p.value).trim()])
    )
    const missing = placeholdersOf(query).filter((name) => !(name in values))
    const base = {
      skillName,
      table: query.table,
      fields: (query.fields || []).join(', '),
      whereClause: query.whereClause || '',
    }
    if (missing.length) return runShape({ ...base, missing })

    const payload = buildQueryPayload(query, values, { maxRows })
    // The exact body abapQuery.runQuery will post – so the chat and the log agree.
    const wireBody = queryRequestBody(payload)
    const requestJson = JSON.stringify(wireBody)
    console.log('runSkill', JSON.stringify({ skillName, parameters: values, body: wireBody }))

    const sent = {
      ...base,
      fields: wireBody.Fields,
      whereClause: wireBody.WhereClause,
      maxRows: wireBody.MaxRows ?? null,
      requestJson,
    }

    let raw
    try {
      raw = await (await repository()).send('runQuery', payload)
    } catch (err) {
      console.error('runSkill: QuerySet call failed', err)
      return runShape({ ...sent, error: err.message })
    }

    const rows = extractRows(raw)
    const columns = rows.length ? Object.keys(rows[0]) : query.fields || []

    // Shape the rows into the answer the skill's `## Return` section describes. A
    // failure here is not fatal – the chat falls back to a raw table.
    let answer = ''
    try {
      answer = await formatSkillAnswer({ question, returns: stored?.doc?.returns, rows })
    } catch (err) {
      console.error('runSkill: answer formatting failed', err)
    }

    return runShape({
      ...sent,
      ran: true,
      rowCount: rows.length,
      columns,
      rowsJson: JSON.stringify(rows),
      answer,
    })
  })
})
