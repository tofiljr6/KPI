import cds from '@sap/cds'
import { routeQuestion } from './lib/skillRouter.js'

export default cds.service.impl(function () {

  this.on('route', async (req) => {
    const { question } = req.data
    if (!question || !question.trim()) return req.error(400, 'Missing "question"')

    let skills
    try {
      const repo = await cds.connect.to('SkillRepositoryService')
      skills = await repo.send('getSkillDocs', {})
    } catch (err) {
      console.error('route: could not load skills', err)
      return req.error(err?.response?.status || 500, err.message)
    }

    try {
      const result = await routeQuestion(question, skills)
      return {
        question: result.question,
        matched: result.matched,
        skillName: result.skill?.SkillName || result.skill?.doc?.name || '',
        skill: result.skill?.doc || null,
        parameters: result.parameters,
        missing: result.missing,
        reason: result.reason,
        considered: skills.length,
        error: null,
      }
    } catch (err) {
      console.error('route failed', err)
      return req.error(500, err.message)
    }
  })
})
