/**
 * End-to-end test: generate a skill and save it to the SAP system.
 * Run inside BAS so the SA1_300 destination / local proxy is reachable.
 *
 *   # generate from a query, then POST to ABAP:
 *   node --env-file=.env scripts/test-save-skill.js "chcę dostać dane adresowe partnera"
 *
 *   # or skip generation and POST a skill JSON directly:
 *   node --env-file=.env scripts/test-save-skill.js --skill '{"SkillName":"GetX","QueryTable":"BUT000","QueryFields":"PARTNER","QueryWhere":"PARTNER = '"'"'{partner}'"'"'"}'
 *
 * .env needs: VCAP_SERVICES + destinations (BAS binding) and OPENAI_API_KEY.
 */
import { runSkillAgent } from '../srv/lib/skillAgent.js'
import { createSkill, listSkills } from '../srv/lib/abapSkills.js'

const args = process.argv.slice(2)
let skill

if (args[0] === '--skill') {
  skill = JSON.parse(args[1])
  console.log('Using skill from argument:\n', JSON.stringify(skill, null, 2))
} else {
  const query = args[0] || 'chcę dostać dane adresowe partnera'
  console.log(`Generating skill for: "${query}"`)
  const draft = await runSkillAgent(query)
  console.log('\nDraft:\n', JSON.stringify(draft, null, 2))
  if (draft.error || !draft.skill) {
    console.error('\nGeneration failed, nothing to save.')
    process.exit(1)
  }
  skill = draft.skill
}

console.log('\n--- POST SkillSet ---')
try {
  const created = await createSkill(skill)
  console.log('Created:\n', created)
} catch (err) {
  console.error('createSkill failed:', err?.response?.status, err?.response?.data ?? err.message)
  process.exit(1)
}

console.log('\n--- GET SkillSet (verify) ---')
try {
  console.log(await listSkills())
} catch (err) {
  console.error('listSkills failed:', err?.response?.status, err?.response?.data ?? err.message)
}
