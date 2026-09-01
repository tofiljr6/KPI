/**
 * Test the generator only (no SAP call).
 *   node --env-file=.env scripts/test-skill-agent.js "chcę dostać dane adresowe partnera"
 *
 * .env needs OPENAI_API_KEY (optionally OPENAI_MODEL).
 */
import { runSkillAgent } from '../srv/lib/skillAgent.js'

const query = process.argv[2] || 'chcę dostać dane adresowe partnera'
const result = await runSkillAgent(query)
console.log(JSON.stringify(result, null, 2))
