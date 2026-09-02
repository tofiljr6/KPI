import cds from '@sap/cds'

const COMMANDS = [
  {
    name: '/create-skill',
    args: '<description>',
    description: 'Generates a skill from your description and saves it to SAP',
    example: '/create-skill I need the address data of a business partner',
  },
  {
    name: '/help',
    args: '',
    description: 'Lists the available commands',
    example: '/help',
  },
]

const helpText = () =>
  [
    'Available commands:',
    '',
    ...COMMANDS.map((c) => `- \`${`${c.name} ${c.args}`.trim()}\` — ${c.description}`),
    '',
    `Example: \`${COMMANDS[0].example}\``,
  ].join('\n')

/** Provider errors are multi-line essays – keep the first line, capped. */
const short = (message) => {
  const first = String(message || 'Unknown error').split('\n')[0].trim()
  return first.length > 240 ? first.slice(0, 237) + '…' : first
}

/** Renders an error as a fenced block so long lines scroll instead of overflowing. */
const asCode = (message) => '```\n' + short(message) + '\n```'

const reply = (kind, text, extra = {}) => ({
  role: 'assistant',
  kind,
  text,
  command: '',
  markdown: null,
  skill: null,
  parameters: [],
  saved: false,
  error: null,
  ...extra,
})

/** '/create-skill dane adresowe' -> { command: '/create-skill', rest: 'dane adresowe' } */
function splitCommand(message) {
  const text = String(message || '').trim()
  if (!text.startsWith('/')) return { command: '', rest: text }
  const [head, ...tail] = text.split(/\s+/)
  return { command: head.toLowerCase(), rest: tail.join(' ').trim() }
}

export default cds.service.impl(function () {

  this.on('commands', () => COMMANDS)

  this.on('chat', async (req) => {
    const { command, rest } = splitCommand(req.data.message)

    if (!command) {
      if (!rest) return req.error(400, 'Missing "message"')
      return reply(
        'text',
        [
          'I do not hold a normal conversation yet — I only act on commands.',
          '',
          `To build a skill, type \`${COMMANDS[0].name} ${COMMANDS[0].args}\`, for example:`,
          '',
          `\`${COMMANDS[0].example}\``,
        ].join('\n')
      )
    }

    if (command === '/help') return reply('text', helpText(), { command })

    if (command !== '/create-skill') {
      return reply('error', `I do not know the command \`${command}\`.\n\n${helpText()}`, {
        command,
        error: `Unknown command ${command}`,
      })
    }

    if (!rest) {
      return reply(
        'text',
        [
          'Tell me which data the skill should cover — add a description after the command:',
          '',
          `\`${COMMANDS[0].example}\``,
        ].join('\n'),
        { command }
      )
    }

    let draft
    try {
      const authoring = await cds.connect.to('SkillAuthoringService')
      draft = await authoring.send('generateSkill', { query: rest })
    } catch (err) {
      console.error('chat: generation failed', err)
      return reply('error', `Could not generate the skill.\n\n${asCode(err.message)}`, {
        command,
        error: err.message,
      })
    }

    if (draft.error || !draft.skill) {
      return reply('error', `The generated document is incomplete.\n\n${asCode(draft.error)}`, {
        command,
        markdown: draft.markdown,
        skill: draft.doc,
        parameters: draft.parameters || [],
        error: draft.error,
      })
    }

    try {
      const repo = await cds.connect.to('SkillRepositoryService')
      await repo.send('createSkill', { skill: draft.skill })
    } catch (err) {
      console.error('chat: save failed', err)
      return reply(
        'error',
        `Skill **${draft.doc.name}** was generated, but saving it to SAP failed.\n\n${asCode(err.message)}`,
        {
          command,
          markdown: draft.markdown,
          skill: draft.doc,
          parameters: draft.parameters || [],
          error: err.message,
        }
      )
    }

    const params = (draft.parameters || []).map((p) => `\`{${p}}\``).join(', ')
    return reply(
      'skill',
      [
        `Done — skill **${draft.doc.name}** saved to SAP.`,
        '',
        `Queries: **${draft.doc.queries.length}**` + (params ? ` · parameters: ${params}` : ''),
      ].join('\n'),
      {
        command,
        markdown: draft.markdown,
        skill: draft.doc,
        parameters: draft.parameters || [],
        saved: true,
      }
    )
  })
})
