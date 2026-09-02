/**
 * Offline check of the answer formatter (no LLM, no SAP).
 *
 *   node scripts/test-skill-answer.js
 *
 * The model is stubbed; what is verified is that it gets the question, the skill's
 * Return spec and the rows, and that the reply is trimmed and never non-string.
 */
import assert from 'node:assert/strict'
import { formatSkillAnswer } from '../srv/lib/skillAnswer.js'

/** A stub standing in for ChatOpenAI. */
const stub = (reply) => ({
  seen: null,
  async invoke(messages) {
    this.seen = messages
    return { content: reply }
  },
})

const chat = stub('- PL: 1234567890\n- DE: 998877')
const out = await formatSkillAnswer(
  {
    question: 'jakie numery identyfikacyjne ma partner 6',
    returns: 'A bullet list, one "TYPE: IDNUMBER" per row. Empty result means "Brak numerów.".',
    rows: [
      { TYPE: 'PL', IDNUMBER: '1234567890' },
      { TYPE: 'DE', IDNUMBER: '998877' },
    ],
  },
  { chat }
)

assert.equal(out, '- PL: 1234567890\n- DE: 998877')

// the model sees the question, the Return section and the rows
const userMessage = chat.seen[1].content
assert.match(userMessage, /jakie numery identyfikacyjne ma partner 6/)
assert.match(userMessage, /Brak numer/)
assert.match(userMessage, /1234567890/)
assert.match(chat.seen[0].content, /Return section/)

// trims whitespace, tolerates a non-string / empty completion
assert.equal(await formatSkillAnswer({ rows: [] }, { chat: stub('  hi  ') }), 'hi')
assert.equal(await formatSkillAnswer({ rows: [] }, { chat: stub(null) }), '')

console.log('--- all answer tests passed')
