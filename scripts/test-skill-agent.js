/**
 * Test the generator only (no SAP call).
 *   node --env-file=.env scripts/test-skill-agent.js "I need the address data of a business partner"
 *   node --env-file=.env scripts/test-skill-agent.js "..." --json    # full result object
 *
 * .env needs OPENAI_API_KEY (optionally OPENAI_MODEL).
 */
import { runSkillAgent } from '../srv/lib/skillAgent.js'

const args = process.argv.slice(2).filter((a) => a !== '--json')
const asJson = process.argv.includes('--json')
const query = args[0] || 'I need the address data of a business partner'

const result = await runSkillAgent(query)

if (asJson) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log(result.markdown)
  console.log('--- parameters:', result.parameters.join(', ') || '(none)')
  console.log('--- table choice:', result.tableChoice.table, `(${result.tableChoice.confidence})`,
    result.tableChoice.alternatives.length ? `alt: ${result.tableChoice.alternatives.join(', ')}` : '')
  console.log('--- reasoning:', result.reasoning)
  if (result.error) console.error('--- ERROR:', result.error)
  else console.log('--- SkillDescription length:', result.skill.SkillDescription.length, 'chars')
}
