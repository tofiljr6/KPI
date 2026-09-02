import cds from '@sap/cds'
import { placeholdersOf } from './lib/skillMarkdown.js'
import { buildQueryPayload, extractRows } from './lib/skillExecutor.js'

/** A fully-populated SkillRun, so every branch returns the same shape. */
const runShape = (extra = {}) => ({
  skillName: '',
  ran: false,
  table: '',
  fields: '',
  whereClause: '',
  maxRows: null,
  rowCount: 0,
  columns: [],
  rowsJson: '[]',
  missing: [],
  error: null,
  ...extra,
})

export default cds.service.impl(function () {

  const repository = () => cds.connect.to('SkillRepositoryService')

  this.on('runSkill', async (req) => {
    const { skillName } = req.data
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

    let raw
    try {
      raw = await (await repository()).send('runQuery', payload)
    } catch (err) {
      console.error('runSkill: QuerySet call failed', err)
      return runShape({
        ...base,
        whereClause: payload.WhereClause,
        maxRows: payload.MaxRows ?? null,
        error: err.message,
      })
    }

    const rows = extractRows(raw)
    const columns = rows.length ? Object.keys(rows[0]) : query.fields || []
    return runShape({
      ...base,
      ran: true,
      whereClause: payload.WhereClause,
      maxRows: payload.MaxRows ?? null,
      rowCount: rows.length,
      columns,
      rowsJson: JSON.stringify(rows),
    })
  })
})
