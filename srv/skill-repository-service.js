import cds from '@sap/cds'
import {
  listSkills,
  listSkillRecords,
  readSkill,
  createSkill,
  updateSkill,
  deleteSkill,
  unwrap,
} from './lib/abapSkills.js'
import { runQuery } from './lib/abapQuery.js'
import { parseSkillMarkdown, validateSkillDoc } from './lib/skillMarkdown.js'

const status = (err) => err?.response?.status || 500

/** The backend's own error text, when the OData service sent one. */
const backendMessage = (err) => {
  const m = err?.response?.data?.error?.message
  return (typeof m === 'object' ? m?.value : m) || err?.message || 'Unknown error'
}

/** Stored record -> the same record with SkillDescription parsed back into a SkillDoc. */
function toStoredSkill(record, match) {
  const markdown = record?.SkillDescription || ''
  const doc = parseSkillMarkdown(markdown)
  return {
    SkillName: record?.SkillName || doc.name,
    SkillTriggerText: record?.SkillTriggerText || '',
    QueryTable: record?.QueryTable || doc.queries[0]?.table || '',
    markdown,
    doc,
    parseWarnings: validateSkillDoc(doc),
    match: match || '',
  }
}

const norm = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * Scores stored records against a name or a free-text description.
 * Exact name (ignoring case and separators) wins; otherwise words from the query
 * are counted across the name and the document text.
 */
function rankRecords(records, query) {
  const wanted = norm(query)
  const words = String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2)

  return records
    .map((record) => {
      const name = record?.SkillName || ''
      const haystack = `${name} ${record?.SkillTriggerText || ''} ${record?.SkillDescription || ''}`.toLowerCase()
      if (wanted && norm(name) === wanted) return { record, score: 1000, match: 'exact' }
      let score = 0
      if (wanted && norm(name).includes(wanted)) score += 100
      for (const word of words) if (haystack.includes(word)) score += 1
      return { record, score, match: 'partial' }
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
}

/** Finds the raw record (with __metadata) that update/delete have to address. */
async function resolveRecord(name) {
  const hits = rankRecords(await listSkillRecords(), name)
  const exact = hits.find((hit) => hit.match === 'exact')
  if (exact) return exact.record
  if (hits.length === 1) return hits[0].record
  return null
}

export default cds.service.impl(function () {

  this.on('getSkills', async (req) => {
    try {
      return await listSkills()
    } catch (err) {
      console.error('getSkills failed', err?.response?.data ?? err)
      return req.error(status(err), backendMessage(err))
    }
  })

  this.on('getSkill', async (req) => {
    const { id } = req.data
    if (!id) return req.error(400, 'Missing "id" parameter')
    try {
      return await readSkill(id)
    } catch (err) {
      console.error('getSkill failed', err?.response?.data ?? err)
      return req.error(status(err), backendMessage(err))
    }
  })

  this.on('getSkillDoc', async (req) => {
    const { id } = req.data
    if (!id) return req.error(400, 'Missing "id" parameter')
    try {
      // The SkillSet key is a GUID (SkillId), so SkillSet('<name>') is a 400. Resolve
      // the id – a name or the GUID – against the feed instead.
      const wanted = String(id).trim().toLowerCase()
      const record = (await listSkillRecords()).find(
        (r) =>
          String(r?.SkillId || '').toLowerCase() === wanted ||
          String(r?.SkillName || '').toLowerCase() === wanted
      )
      if (!record) return req.error(404, `Skill "${id}" not found`)
      return toStoredSkill(record)
    } catch (err) {
      console.error('getSkillDoc failed', err?.response?.data ?? err)
      return req.error(status(err), backendMessage(err))
    }
  })

  this.on('getSkillDocs', async (req) => {
    try {
      return unwrap(await listSkills()).map(toStoredSkill)
    } catch (err) {
      console.error('getSkillDocs failed', err?.response?.data ?? err)
      return req.error(status(err), backendMessage(err))
    }
  })

  this.on('findSkills', async (req) => {
    const { query } = req.data
    if (!query || !query.trim()) return req.error(400, 'Missing "query" parameter')
    try {
      const records = await listSkillRecords()
      return rankRecords(records, query).map((hit) => toStoredSkill(hit.record, hit.match))
    } catch (err) {
      console.error('findSkills failed', err?.response?.data ?? err)
      return req.error(status(err), backendMessage(err))
    }
  })

  this.on('updateSkill', async (req) => {
    const { name, skill } = req.data
    if (!name) return req.error(400, 'Missing "name"')
    if (!skill || !skill.SkillName) return req.error(400, 'Missing "skill.SkillName"')
    try {
      const record = await resolveRecord(name)
      if (!record) return req.error(404, `Skill "${name}" not found`)
      return await updateSkill(record, skill)
    } catch (err) {
      console.error('updateSkill failed', err?.response?.data ?? err)
      return req.error(status(err), backendMessage(err))
    }
  })

  this.on('deleteSkill', async (req) => {
    const { name } = req.data
    if (!name) return req.error(400, 'Missing "name"')
    try {
      const record = await resolveRecord(name)
      if (!record) return req.error(404, `Skill "${name}" not found`)
      return await deleteSkill(record)
    } catch (err) {
      console.error('deleteSkill failed', err?.response?.data ?? err)
      return req.error(status(err), backendMessage(err))
    }
  })

  this.on('createSkill', async (req) => {
    const { skill } = req.data
    if (!skill || !skill.SkillName) return req.error(400, 'Missing "skill.SkillName"')
    try {
      return await createSkill(skill)
    } catch (err) {
      console.error('createSkill failed', err?.response?.data ?? err)
      return req.error(status(err), backendMessage(err))
    }
  })

  this.on('runQuery', async (req) => {
    const { TableName, Fields, WhereClause, MaxRows } = req.data
    if (!TableName || !TableName.trim()) return req.error(400, 'Missing "TableName"')
    if (!Fields || !Fields.trim()) return req.error(400, 'Missing "Fields"')
    try {
      return await runQuery({ TableName, Fields, WhereClause, MaxRows })
    } catch (err) {
      console.error('runQuery failed', err?.response?.data ?? err)
      return req.error(status(err), backendMessage(err))
    }
  })
})
