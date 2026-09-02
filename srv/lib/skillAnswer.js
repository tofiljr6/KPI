import { model } from './model.js'

/**
 * Turns the rows a skill's query returned into the answer the user asked for, in the
 * shape the skill's `## Return` section describes.
 *
 * The skill document already specifies what comes back and how (a single value, a
 * sentence, a Markdown table of named columns, a bullet list, what an empty result
 * means). This step follows that spec instead of always dumping a raw table.
 */

const SYSTEM = [
  'You present the result of one SAP query as the answer to a question.',
  '',
  'You get three things: the user question, the skill\'s "Return" section (it describes',
  'the exact shape of the answer), and the result rows as JSON.',
  '',
  'Rules:',
  '- Produce the answer in the form the Return section describes — a single value, one',
  '  sentence, a Markdown table with the columns it names, a bullet list, whatever it says.',
  '- Use only the values in the rows. Never invent or guess. Leave a cell blank if the',
  '  field is missing.',
  '- Keep SAP values verbatim: identifiers with their leading zeros, dates and codes as',
  '  returned. Do not reformat them.',
  '- No rows: give the one-line "empty result" answer from the Return section, or "No',
  '  data." if it says nothing.',
  '- No preamble, no sign-off, do not restate the question. Output only the answer.',
  '- Write in the language of the question.',
].join('\n')

/**
 * `options.chat` replaces the LLM (tests). Returns the answer as a Markdown string,
 * or '' when the model gives nothing back.
 */
export async function formatSkillAnswer({ question, returns, rows } = {}, options = {}) {
  const llm = options.chat || model()
  const response = await llm.invoke([
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: [
        `Question: ${question || '(not given)'}`,
        '',
        'Return section of the skill:',
        String(returns || '(none)').trim(),
        '',
        'Result rows (JSON):',
        JSON.stringify(rows ?? [], null, 2),
      ].join('\n'),
    },
  ])
  const content = response?.content
  return (typeof content === 'string' ? content : String(content ?? '')).trim()
}
