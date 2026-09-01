import cds from '@sap/cds'
import { listSkills, readSkill, createSkill } from './lib/abapSkills.js'

const status = (err) => err?.response?.status || 500

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
