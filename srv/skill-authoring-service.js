import cds from '@sap/cds'
import { runSkillAgent, runSkillRevision } from './lib/skillAgent.js'
import { parseSkillMarkdown, renderSkillMarkdown } from './lib/skillMarkdown.js'

export default cds.service.impl(function () {

  this.on('generateSkill', async (req) => {
    const { query, version, status } = req.data
    if (!query || !query.trim()) return req.error(400, 'Missing "query"')
    try {
      return await runSkillAgent(query, { version, status })
    } catch (err) {
      console.error('generateSkill failed', err)
      return req.error(500, err.message)
    }
  })

  this.on('generateAndCreateSkill', async (req) => {
    const { query, version, status } = req.data
    if (!query || !query.trim()) return req.error(400, 'Missing "query"')

    let draft
    try {
      draft = await runSkillAgent(query, { version, status })
    } catch (err) {
      console.error('generateAndCreateSkill: generation failed', err)
      return req.error(500, err.message)
    }

    if (draft.error || !draft.skill) {
      return JSON.stringify(draft)
    }

    const repo = await cds.connect.to('SkillRepositoryService')
    return repo.send('createSkill', { skill: draft.skill })
  })

  this.on('reviseSkill', async (req) => {
    const { markdown, instruction, version, status } = req.data
    if (!markdown || !markdown.trim()) return req.error(400, 'Missing "markdown"')
    if (!instruction || !instruction.trim()) return req.error(400, 'Missing "instruction"')
    try {
      return await runSkillRevision(markdown, instruction, { version, status })
    } catch (err) {
      console.error('reviseSkill failed', err)
      return req.error(500, err.message)
    }
  })

  this.on('parseSkillMarkdown', (req) => {
    const { markdown } = req.data
    if (!markdown || !markdown.trim()) return req.error(400, 'Missing "markdown"')
    return parseSkillMarkdown(markdown)
  })

  this.on('renderSkillMarkdown', (req) => {
    const { doc } = req.data
    if (!doc || !doc.name) return req.error(400, 'Missing "doc.name"')
    return renderSkillMarkdown(doc)
  })
})
