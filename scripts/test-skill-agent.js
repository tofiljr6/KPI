/**
 * Local test of the skill-generation agent without CAP / destination.
 *   OPENAI_API_KEY=sk-... [TAVILY_API_KEY=tvly-...] \
 *     node scripts/test-skill-graph.js "chcę dostać dane adresowe partnera"
 */
import { runSkillAgent } from '../srv/lib/skillAgent.js'

const query = process.argv[2] || 'chcę dostać dane adresowe partnera'
const result = await runSkillAgent(query)
console.log(JSON.stringify(result, null, 2))
