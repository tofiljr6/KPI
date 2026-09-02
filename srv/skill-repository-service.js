import cds from '@sap/cds'
import { listSkills, readSkill, createSkill } from './lib/abapSkills.js'
import { parseSkillMarkdown, validateSkillDoc } from './lib/skillMarkdown.js'

const status = (err) => err?.response?.status || 500

/** OData V2 payloads come wrapped in { d: ... } / { d: { results: [...] } }. */
function unwrap(raw) {
  const body = typeof raw === 'string' ? JSON.parse(raw) : raw
  const d = body?.d ?? body
  return Array.isArray(d?.results) ? d.results : Array.isArray(d) ? d : [d].filter(Boolean)
}

/** Stored record -> the same record with SkillDescription parsed back into a SkillDoc. */
function toStoredSkill(record) {
  const markdown = record?.SkillDescription || ''
  const doc = parseSkillMarkdown(markdown)
  return {
    SkillName: record?.SkillName || doc.name,
    SkillTriggerText: record?.SkillTriggerText || '',
    QueryTable: record?.QueryTable || doc.queries[0]?.table || '',
    markdown,
    doc,
    parseWarnings: validateSkillDoc(doc),
  }
}

export default cds.service.impl(function () {

  this.on('getSkills', async (req) => {
    try {
      return await listSkills()
    } catch (err) {
      console.error('getSkills failed', err?.response?.data ?? err)
      return req.error(status(err), err.message)
    }
  })

  this.on('getSkill', async (req) => {
    const { id } = req.data
    if (!id) return req.error(400, 'Missing "id" parameter')
    try {
      return await readSkill(id)
    } catch (err) {
      console.error('getSkill failed', err?.response?.data ?? err)
      return req.error(status(err), err.message)
    }
  })

  this.on('getSkillDoc', async (req) => {
    const { id } = req.data
    if (!id) return req.error(400, 'Missing "id" parameter')
    try {
      const [record] = unwrap(await readSkill(id))
      if (!record) return req.error(404, `Skill "${id}" not found`)
      return toStoredSkill(record)
    } catch (err) {
      console.error('getSkillDoc failed', err?.response?.data ?? err)
      return req.error(status(err), err.message)
    }
  })

  this.on('getSkillDocs', async (req) => {
    try {
      return unwrap(await listSkills()).map(toStoredSkill)
    } catch (err) {
      console.error('getSkillDocs failed', err?.response?.data ?? err)
      return req.error(status(err), err.message)
    }
  })

  this.on('createSkill', async (req) => {
    const { skill } = req.data
    if (!skill || !skill.SkillName) return req.error(400, 'Missing "skill.SkillName"')
    try {
      return await createSkill(skill)
    } catch (err) {
      console.error('createSkill failed', err?.response?.data ?? err)
      return req.error(status(err), err.message)
    }
  })
})
