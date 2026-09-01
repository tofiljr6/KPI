/**
 * Local test of the skill-generation agent without CAP / destination.
 * Loads .env via Node's --env-file flag (Node 20.6+):
 *
 *   node --env-file=.env scripts/test-skill-agent.js "chcę dostać dane adresowe partnera"
 *
 * .env needs OPENAI_API_KEY (and optionally OPENAI_MODEL, TAVILY_API_KEY).
 */
import { runSkillAgent } from '../srv/lib/skillAgent.js'

const query = process.argv[2] || 'chcę dostać dane adresowe partnera'
const result = await runSkillAgent(query)
console.log(JSON.stringify(result, null, 2))
