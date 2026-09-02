import cds from '@sap/cds'
import { placeholdersOf, requiredPlaceholders } from './lib/skillMarkdown.js'
import { buildQueryPayload, extractRows, harvestValues } from './lib/skillExecutor.js'
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
  stepsJson: '[]',
  answer: '',
  missing: [],
  note: null,
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

    const doc = stored?.doc || {}
    const queries = (doc.queries || []).filter((q) => q && q.table)
    if (!queries.length) {
      return runShape({ skillName, error: `Skill "${skillName}" has no runnable query.` })
    }

    const firstBase = {
      skillName,
      table: queries[0].table,
      fields: (queries[0].fields || []).join(', '),
      whereClause: queries[0].whereClause || '',
    }

    // Values keyed by placeholder name: the request supplies some, each step's first row
    // adds the rest (harvestValues) for the steps that follow it.
    const values = Object.fromEntries(
      parameters
        .filter((p) => p && p.name && String(p.value ?? '').trim())
        .map((p) => [p.name, String(p.value).trim()])
    )

    // Chained placeholders (produced by an earlier step) are NOT the caller's job.
    const missing = requiredPlaceholders(doc).filter((name) => !(name in values))
    if (missing.length) return runShape({ ...firstBase, missing })

    const repo = await repository()
    const steps = []
    let requestJson = ''
    let note = null

    for (let i = 0; i < queries.length; i++) {
      const q = queries[i]
      const unresolved = placeholdersOf(q).filter((name) => !(name in values))
      if (unresolved.length) {
        note = `Step ${i + 1} ("${q.name}") needs ${unresolved.map((p) => `{${p}}`).join(', ')}, ` +
          `which the previous step did not return — stopping here.`
        break
      }

      const payload = buildQueryPayload(q, values, { maxRows })
      const wireBody = queryRequestBody(payload)
      if (i === 0) requestJson = JSON.stringify(wireBody)
      console.log(
        `runSkill ${skillName} step ${i + 1}/${queries.length}`,
        JSON.stringify({ body: wireBody })
      )

      let raw
      try {
        raw = await repo.send('runQuery', payload)
      } catch (err) {
        console.error(`runSkill: step ${i + 1} QuerySet call failed`, err)
        if (i === 0) {
          return runShape({
            ...firstBase,
            whereClause: wireBody.WhereClause,
            maxRows: wireBody.MaxRows ?? null,
            requestJson,
            error: err.message,
          })
        }
        note = `Step ${i + 1} ("${q.name}") failed: ${err.message} — returning what ran.`
        break
      }

      const rows = extractRows(raw)
      steps.push({ name: q.name, table: q.table, whereClause: wireBody.WhereClause, rowCount: rows.length, rows })

      for (const [column, value] of Object.entries(harvestValues(rows))) {
        if (!(column in values)) values[column] = value
      }
    }

    if (!steps.length) {
      return runShape({ ...firstBase, error: note || 'Nothing ran.' })
    }

    const lastStep = steps[steps.length - 1]
    const lastQuery = queries[steps.length - 1] || {}
    const columns = lastStep.rows.length ? Object.keys(lastStep.rows[0]) : lastQuery.fields || []

    // Format the whole result per the skill's `## Return`. One block per step when the
    // skill has several; a failure here is not fatal (the chat falls back to a table).
    let answer = ''
    try {
      answer = await formatSkillAnswer({
        question,
        returns: doc.returns,
        rows:
          steps.length === 1
            ? lastStep.rows
            : steps.map((s) => ({ step: s.name, table: s.table, rows: s.rows })),
      })
    } catch (err) {
      console.error('runSkill: answer formatting failed', err)
    }

    return runShape({
      skillName,
      ran: true,
      table: lastStep.table,
      fields: (lastQuery.fields || []).join(', '),
      whereClause: lastStep.whereClause,
      maxRows: maxRows ?? null,
      requestJson,
      rowCount: lastStep.rowCount,
      columns,
      rowsJson: JSON.stringify(lastStep.rows),
      stepsJson: JSON.stringify(
        steps.map((s) => ({ name: s.name, table: s.table, whereClause: s.whereClause, rowCount: s.rowCount }))
      ),
      answer,
      note,
    })
  })
})
