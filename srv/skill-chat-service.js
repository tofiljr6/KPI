import cds from '@sap/cds'
import {
  parseSkillMarkdown,
  validateSkillDoc,
  renderSkillMarkdown,
  normalizeSkillDoc,
  placeholdersOf,
  compareVersions,
  bumpVersion,
  todayStamp,
} from './lib/skillMarkdown.js'
import { toSkillInput } from './lib/skillAgent.js'

const COMMANDS = [
  {
    name: '/create-skill',
    args: '<description>',
    description: 'Drafts a new skill from your description',
    example: '/create-skill I need the address data of a business partner',
  },
  {
    name: '/update-skill',
    args: '<skill name>',
    description: 'Opens a stored skill so you can describe changes',
    example: '/update-skill GetBusinessPartnerAddress',
  },
  {
    name: '/delete-skill',
    args: '<name or description>',
    description: 'Finds a stored skill and offers to delete it',
    example: '/delete-skill GetBusinessPartnerAddress',
  },
  {
    name: '/list-skills',
    args: '',
    description: 'Lists every skill currently stored in SAP',
    example: '/list-skills',
  },
  {
    name: '/help',
    args: '',
    description: 'Lists the available commands',
    example: '/help',
  },
]

const SAVE_HINT = 'Edit it here if you like — nothing reaches SAP until you click **Save skill**.'

const helpText = () =>
  [
    'Available commands:',
    '',
    ...COMMANDS.map((c) => `- \`${`${c.name} ${c.args}`.trim()}\` — ${c.description}`),
    '',
    'Nothing is written to SAP by a command alone: saving and deleting always take a',
    'button click on the card.',
  ].join('\n')

/** Provider errors are multi-line essays – keep the first line, capped. */
const short = (message) => {
  const first = String(message || 'Unknown error').split('\n')[0].trim()
  return first.length > 240 ? first.slice(0, 237) + '…' : first
}

/** Renders an error as a fenced block so long lines scroll instead of overflowing. */
const asCode = (message) => '```\n' + short(message) + '\n```'

const ROW_LIMIT = 50
const mdCell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()

/** A SkillRun's rows as a Markdown table, capped at ROW_LIMIT. */
function renderRows(run) {
  let rows
  try {
    rows = JSON.parse(run.rowsJson || '[]')
  } catch {
    rows = []
  }
  if (!Array.isArray(rows) || !rows.length) return '_No rows matched._'

  const columns = run.columns?.length ? run.columns : Object.keys(rows[0])
  const shown = rows.slice(0, ROW_LIMIT)
  const table = [
    `| ${columns.join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...shown.map((row) => `| ${columns.map((c) => mdCell(row[c])).join(' | ')} |`),
  ].join('\n')

  return rows.length > ROW_LIMIT ? `${table}\n\n_Showing ${ROW_LIMIT} of ${rows.length} rows._` : table
}

const reply = (kind, text, extra = {}) => ({
  role: 'assistant',
  kind,
  text,
  command: '',
  actions: [],
  markdown: null,
  skill: null,
  parameters: [],
  mode: '',
  target: '',
  storedVersion: '',
  candidates: [],
  saved: false,
  error: null,
  ...extra,
})

/** '/create-skill address data' -> { command: '/create-skill', rest: 'address data' } */
function splitCommand(message) {
  const text = String(message || '').trim()
  if (!text.startsWith('/')) return { command: '', rest: text }
  const [head, ...tail] = text.split(/\s+/)
  return { command: head.toLowerCase(), rest: tail.join(' ').trim() }
}

const candidateOf = (hit) => ({
  name: hit.SkillName,
  description: hit.doc?.description || hit.SkillTriggerText || '',
  version: hit.doc?.version || '',
  status: hit.doc?.status || '',
})

/** A document draft, ready for the card. Never saved at this point. */
const draftReply = (text, { markdown, doc, parameters, mode, target, storedVersion, command }) =>
  reply('skill', text, {
    command: command || '',
    actions: ['save'],
    markdown,
    skill: doc,
    parameters: parameters || [],
    mode,
    target: target || doc.name,
    storedVersion: storedVersion || '',
  })

export default cds.service.impl(function () {

  const authoring = () => cds.connect.to('SkillAuthoringService')
  const repository = () => cds.connect.to('SkillRepositoryService')
  const routing = () => cds.connect.to('SkillRoutingService')
  const execution = () => cds.connect.to('SkillExecutionService')

  this.on('commands', () => COMMANDS)

  /* ------------------------------------------------------------- one turn -- */

  this.on('chat', async (req) => {
    const context = req.data.context || {}
    const { command, rest } = splitCommand(req.data.message)

    if (!command) {
      if (!rest) return req.error(400, 'Missing "message"')
      // A document open for editing turns plain messages into revision instructions;
      // otherwise the question goes to the router, which answers out of the repository.
      const editing = context.markdown && (context.mode === 'create' || context.mode === 'update')
      return editing ? reviseDraft(rest, context) : routeQuestion(rest)
    }

    if (command === '/help') return reply('text', helpText(), { command })
    if (command === '/create-skill') return createSkill(rest, command)
    if (command === '/update-skill') return openSkill(rest, command)
    if (command === '/delete-skill') return findForDelete(rest, command)
    if (command === '/list-skills') return listStoredSkills(command)

    return reply('error', `I do not know the command \`${command}\`.\n\n${helpText()}`, {
      command,
      error: `Unknown command ${command}`,
    })
  })

  /**
   * A question with no document open: hand it to the router, which may only answer
   * out of the stored skills. It never runs the skill – picking one is the answer.
   */
  async function routeQuestion(question) {
    let route
    try {
      route = await (await routing()).send('route', { question })
    } catch (err) {
      console.error('chat: routing failed', err)
      return reply('error', `Could not work out which skill to use.\n\n${asCode(err.message)}`, {
        error: err.message,
      })
    }

    const checked = route.considered
      ? `_Checked ${route.considered} stored skill${route.considered === 1 ? '' : 's'}._`
      : ''

    if (!route.matched) {
      return reply(
        'route',
        [
          `I do not know how to do that. ${route.reason}`,
          '',
          `I can only answer with skills that are stored in SAP — if this one should exist,` +
            ` create it with \`${COMMANDS[0].name} <description>\`.`,
          '',
          checked,
        ]
          .filter(Boolean)
          .join('\n'),
        { mode: 'route' }
      )
    }

    const given = route.parameters.map((p) => `\`{${p.name}}\` = \`${p.value}\``).join(', ')

    // A routed answer names the skill it used, then just shows the result. It is not a
    // draft: no document card (that is only for creating / editing a skill), no query.
    const routeExtra = { mode: 'route', target: route.skillName }

    // Something is still missing – name it and stop; nothing runs until it is supplied.
    if (route.missing.length) {
      const missing = route.missing.map((p) => `\`{${p}}\``).join(', ')
      return reply(
        'route',
        [
          `Use the skill **${route.skillName}** for this.`,
          given ? `From your request: ${given}` : 'Your request supplies no parameter values yet.',
          `Still needed: ${missing} — give me ${route.missing.length === 1 ? 'that' : 'those'} and I will run it.`,
        ].join('\n\n'),
        routeExtra
      )
    }

    // Every placeholder has a value → run the skill's first query against SAP.
    let run
    try {
      run = await (await execution()).send('runSkill', {
        question,
        skillName: route.skillName,
        parameters: route.parameters,
      })
    } catch (err) {
      console.error('chat: skill execution failed', err)
      return reply(
        'route',
        `Use the skill **${route.skillName}** for this, but running it failed.\n\n${asCode(err.message)}`,
        routeExtra
      )
    }

    if (!run.ran) {
      const attempted = run.requestJson
        ? `Sent to \`QuerySet\`:\n\n\`\`\`json\n${run.requestJson}\n\`\`\``
        : null
      return reply(
        'route',
        [
          `Use the skill **${route.skillName}** for this.`,
          run.error ? `Running it failed:\n\n${asCode(run.error)}` : 'I could not run it automatically.',
          attempted,
        ]
          .filter((part) => part != null && part !== '')
          .join('\n\n'),
        routeExtra
      )
    }

    // The answer follows the skill's `## Return` section; fall back to a raw table if
    // the formatting step gave nothing back.
    const body = run.answer?.trim() || renderRows(run)

    return reply(
      'route',
      `_Answered with **${route.skillName}**._\n\n${body}`,
      routeExtra
    )
  }

  /** /list-skills – every stored skill as a table. Read-only, no card. */
  async function listStoredSkills(command) {
    let skills
    try {
      skills = await (await repository()).send('getSkillDocs', {})
    } catch (err) {
      console.error('chat: getSkillDocs failed', err)
      return unreachable(err.message, command)
    }

    if (!skills.length) {
      return reply(
        'text',
        `No skills are stored in SAP yet. Create one with \`${COMMANDS[0].name} <description>\`.`,
        { command }
      )
    }

    const cell = (value) => String(value ?? '').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()
    const rows = skills
      .map((skill) => {
        const doc = skill.doc || {}
        return {
          name: doc.name || skill.SkillName || '(unnamed)',
          version: doc.version || '',
          status: doc.status || '',
          description: doc.description || skill.SkillTriggerText || '',
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    const table = [
      '| Skill | Version | Status | Description |',
      '| --- | --- | --- | --- |',
      ...rows.map((r) => `| ${cell(r.name)} | ${cell(r.version)} | ${cell(r.status)} | ${cell(r.description)} |`),
    ].join('\n')

    return reply(
      'text',
      `${skills.length} skill${skills.length === 1 ? '' : 's'} stored in SAP:\n\n${table}`,
      { command }
    )
  }

  /** /create-skill – an existing name opens that skill instead of drafting a duplicate. */
  async function createSkill(description, command) {
    if (!description) {
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

    // An existing name opens that skill rather than drafting a duplicate.
    const lookup = await find(description)
    if (lookup.error) return unreachable(lookup.error, command)
    const existing = lookup.hits.find((hit) => hit.match === 'exact')
    if (existing) return openStored(existing, command)

    let draft
    try {
      draft = await (await authoring()).send('generateSkill', { query: description })
    } catch (err) {
      console.error('chat: generation failed', err)
      return reply('error', `Could not generate the skill.\n\n${asCode(err.message)}`, {
        command,
        error: err.message,
      })
    }

    if (draft.error || !draft.doc) {
      return reply('error', `The generated document is incomplete.\n\n${asCode(draft.error)}`, {
        command,
        markdown: draft.markdown,
        skill: draft.doc,
        parameters: draft.parameters || [],
        error: draft.error,
      })
    }

    return draftReply(
      [
        `Drafted **${draft.doc.name}** — ${draft.doc.queries.length} quer${draft.doc.queries.length === 1 ? 'y' : 'ies'}` +
          (draft.parameters?.length ? `, parameters ${draft.parameters.map((p) => `\`{${p}}\``).join(', ')}` : '') +
          '.',
        '',
        SAVE_HINT,
      ].join('\n'),
      { markdown: draft.markdown, doc: draft.doc, parameters: draft.parameters, mode: 'create', command }
    )
  }

  /** /update-skill – load a stored skill into the chat. */
  async function openSkill(query, command) {
    if (!query) {
      return reply('text', `Which skill? For example \`${COMMANDS[1].example}\`.`, { command })
    }
    const lookup = await find(query)
    if (lookup.error) return unreachable(lookup.error, command)
    if (!lookup.hits.length) return reply('error', noMatchText(query), { command, error: 'No match' })

    const single =
      lookup.hits.find((h) => h.match === 'exact') || (lookup.hits.length === 1 ? lookup.hits[0] : null)
    if (!single) return chooseReply(lookup.hits, 'Which skill do you want to open?', command)
    return openStored(single, command)
  }

  function openStored(hit, command) {
    const doc = normalizeSkillDoc(hit.doc)
    const warnings = hit.parseWarnings?.length
      ? `\n\n_Note: the stored document is incomplete (${hit.parseWarnings.join('; ')})._`
      : ''
    return draftReply(
      [
        `Opened **${doc.name}** (v${doc.version}, ${doc.status}).`,
        '',
        'Describe the changes you want and I will revise it, or edit the document directly.' +
          ' It is saved back to SAP only when you click **Save skill**.' +
          warnings,
      ].join('\n'),
      {
        markdown: hit.markdown,
        doc,
        parameters: [...new Set(doc.queries.flatMap((q) => placeholdersOf(q)))],
        mode: 'update',
        target: doc.name,
        storedVersion: doc.version,
        command,
      }
    )
  }

  /** Plain message while a document is open: revise it. */
  async function reviseDraft(instruction, context) {
    const isUpdate = context.mode === 'update'
    // Bump off the stored version, not off the draft, so repeated edits stay at one bump.
    const version = isUpdate && context.storedVersion ? bumpVersion(context.storedVersion, 'minor') : undefined

    let revision
    try {
      revision = await (await authoring()).send('reviseSkill', {
        markdown: context.markdown,
        instruction,
        version,
      })
    } catch (err) {
      console.error('chat: revision failed', err)
      return reply('error', `Could not revise the skill.\n\n${asCode(err.message)}`, {
        error: err.message,
        markdown: context.markdown,
        mode: context.mode,
        target: context.name,
        storedVersion: context.storedVersion,
        actions: ['save'],
      })
    }

    if (revision.error) {
      return reply('error', `The revised document is incomplete.\n\n${asCode(revision.error)}`, {
        markdown: revision.markdown,
        skill: revision.doc,
        mode: context.mode,
        target: context.name,
        storedVersion: context.storedVersion,
        error: revision.error,
      })
    }

    const versionNote = isUpdate ? ` Version goes to **${revision.doc.version}** on save.` : ''
    return draftReply(
      `Updated the document.${versionNote}\n\n${SAVE_HINT}`,
      {
        markdown: revision.markdown,
        doc: revision.doc,
        parameters: revision.parameters,
        mode: context.mode || 'create',
        target: context.name || revision.doc.name,
        storedVersion: context.storedVersion,
      }
    )
  }

  /** /delete-skill – resolve, then hand the user a card with a Delete button. */
  async function findForDelete(query, command) {
    if (!query) {
      return reply('text', `Which skill should I delete? For example \`${COMMANDS[2].example}\`.`, { command })
    }
    const lookup = await find(query)
    if (lookup.error) return unreachable(lookup.error, command)
    if (!lookup.hits.length) return reply('error', noMatchText(query), { command, error: 'No match' })

    const single =
      lookup.hits.find((h) => h.match === 'exact') || (lookup.hits.length === 1 ? lookup.hits[0] : null)
    if (!single) return chooseReply(lookup.hits, 'Which skill should I delete?', command, 'delete')

    const doc = normalizeSkillDoc(single.doc)
    return reply(
      'delete',
      [
        `Found **${doc.name}** (v${doc.version}, ${doc.status}) — ${doc.description || 'no description'}`,
        '',
        'Deleting it from SAP cannot be undone. Click **Delete skill** to confirm.',
      ].join('\n'),
      {
        command,
        actions: ['delete'],
        markdown: single.markdown,
        skill: doc,
        target: doc.name,
        mode: 'delete',
      }
    )
  }

  function chooseReply(hits, question, command, intent) {
    return reply('choice', `${question} I found ${hits.length} matches.`, {
      command,
      candidates: hits.slice(0, 8).map(candidateOf),
      mode: intent || 'open',
    })
  }

  const noMatchText = (query) =>
    `No stored skill matches \`${query}\`. Use \`/create-skill <description>\` to draft a new one.`

  /** Never throws: a backend that is down must reach the user as a bubble, not a 500. */
  async function find(query) {
    try {
      return { hits: await (await repository()).send('findSkills', { query }) }
    } catch (err) {
      console.error('chat: findSkills failed', err)
      return { hits: [], error: err.message }
    }
  }

  const unreachable = (message, command) =>
    reply('error', `Could not reach the skill repository in SAP.\n\n${asCode(message)}`, {
      command,
      error: message,
    })

  /* ---------------------------------------------------------- the buttons -- */

  this.on('saveSkill', async (req) => {
    const { markdown, mode, name, storedVersion } = req.data
    if (!markdown || !markdown.trim()) return req.error(400, 'Missing "markdown"')

    const doc = parseSkillMarkdown(markdown)
    const problems = validateSkillDoc(doc)
    if (problems.length) {
      return reply('error', `The document cannot be saved yet.\n\n${asCode(problems.join('; '))}`, {
        markdown,
        skill: doc,
        mode,
        target: name,
        storedVersion,
        actions: ['save'],
        error: problems.join('; '),
      })
    }

    const isUpdate = mode === 'update'
    // Every save stamps today's date; an update also guarantees a higher version.
    doc.lastUpdated = todayStamp()
    if (isUpdate && storedVersion && compareVersions(doc.version, storedVersion) <= 0) {
      doc.version = bumpVersion(storedVersion, 'minor')
    }

    const finalMarkdown = renderSkillMarkdown(doc)
    const skill = toSkillInput(doc, { trigger: doc.description, markdown: finalMarkdown })

    try {
      const repo = await repository()
      if (isUpdate) await repo.send('updateSkill', { name: name || doc.name, skill })
      else await repo.send('createSkill', { skill })
    } catch (err) {
      console.error('saveSkill failed', err)
      return reply('error', `Saving **${doc.name}** to SAP failed.\n\n${asCode(err.message)}`, {
        markdown: finalMarkdown,
        skill: doc,
        mode,
        target: name || doc.name,
        storedVersion,
        actions: ['save'],
        error: err.message,
      })
    }

    return reply(
      'skill',
      isUpdate
        ? `Saved — **${doc.name}** updated in SAP, now v${doc.version} (${doc.lastUpdated}).`
        : `Saved — **${doc.name}** created in SAP as v${doc.version} (${doc.lastUpdated}).`,
      {
        markdown: finalMarkdown,
        skill: doc,
        parameters: [...new Set(doc.queries.flatMap((q) => placeholdersOf(q)))],
        // `mode: update` only so a hand-edit + Save on *this* card is a PUT, not a
        // duplicate POST. `saved: true` tells the UI to drop the editing context, so
        // the next plain message is a data request again — not a revision. Editing a
        // stored skill needs an explicit /update-skill.
        mode: 'update',
        target: doc.name,
        storedVersion: doc.version,
        actions: ['save'],
        saved: true,
      }
    )
  })

  this.on('confirmDelete', async (req) => {
    const { name } = req.data
    if (!name) return req.error(400, 'Missing "name"')
    try {
      await (await repository()).send('deleteSkill', { name })
    } catch (err) {
      console.error('confirmDelete failed', err)
      return reply('error', `Deleting **${name}** failed.\n\n${asCode(err.message)}`, {
        target: name,
        actions: ['delete'],
        error: err.message,
      })
    }
    return reply('text', `Deleted — **${name}** is gone from SAP.`, { target: name, saved: true })
  })
})
