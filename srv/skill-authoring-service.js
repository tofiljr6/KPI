import cds from '@sap/cds'
import { runSkillAgent } from './lib/skillAgent.js'

export default cds.service.impl(function () {

  this.on('generateSkill', async (req) => {
    const { query } = req.data
    if (!query || !query.trim()) return req.error(400, 'Missing "query"')
    try {
      return await runSkillAgent(query)
    } catch (err) {
      console.error('generateSkill failed', err)
      return req.error(500, err.message)
    }
  })

  this.on('generateAndCreateSkill', async (req) => {
    const { query } = req.data
    if (!query || !query.trim()) return req.error(400, 'Missing "query"')

    let draft
    try {
      draft = await runSkillAgent(query)
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
})
