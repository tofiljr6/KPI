/**
 * Skill document <-> Markdown string.
 *
 * A skill is authored as one Markdown document (the shape Claude's `skill-create`
 * produces) and persisted in SAP as a plain string in `SkillDescription`:
 *
 *   ---
 *   name: GetBusinessPartnerAddress
 *   description: Returns the address data of a business partner.
 *   version: 1.0.0
 *   last_updated: 2026-09-02
 *   status: draft
 *   ---
 *
 *   # GetBusinessPartnerAddress
 *
 *   ## Purpose
 *   ...
 *
 *   ## Query
 *   ### 1. Adres partnera
 *   ...
 *   ```sql
 *   SELECT ...
 *   ```
 *
 *   ## Return
 *   ...
 *
 * `renderSkillMarkdown(doc)` and `parseSkillMarkdown(md)` are inverses:
 * render -> parse -> render is stable. The parser is deliberately lenient
 * (heading aliases in PL/DE/EN, optional numbering, free-form SQL), the
 * renderer is strict so what we write always round-trips.
 */

export const SECTION_TITLES = {
  purpose: 'Purpose',
  queries: 'Query',
  returns: 'Return',
}

// The aliases keep the older PL/DE headings readable, so documents stored before
// the format was unified in English still parse (and normalise on re-render).
const SECTION_ALIASES = {
  purpose: ['purpose', 'goal', 'cel tego skilla', 'cel', 'cel skilla', 'ziel', 'ziel dieses skills'],
  queries: ['query', 'queries', 'sql', 'zapytania', 'zapytanie', 'abfragen', 'abfrage'],
  returns: ['return', 'returns', 'output', 'ruckgabe', 'zwrotka', 'wynik', 'wyjscie'],
}

const FRONTMATTER_ALIASES = {
  name: 'name',
  description: 'description',
  desc: 'description',
  version: 'version',
  'last updated': 'lastUpdated',
  last_updated: 'lastUpdated',
  'last-updated': 'lastUpdated',
  lastupdated: 'lastUpdated',
  updated: 'lastUpdated',
  status: 'status',
}

/** Emitted frontmatter keys, in order. */
const FRONTMATTER_ORDER = [
  ['name', 'name'],
  ['description', 'description'],
  ['version', 'version'],
  ['lastUpdated', 'last_updated'],
  ['status', 'status'],
]

export const SKILL_STATUS = ['draft', 'active', 'deprecated']

const fold = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[:.\s]+$/, '')
    .trim()

const today = () => new Date().toISOString().slice(0, 10)

/* ------------------------------------------------------------------ SQL --- */

/** { table, fields, whereClause } -> a single formatted OpenSQL SELECT. */
export function buildSql({ table, fields, whereClause } = {}) {
  const cols = (Array.isArray(fields) ? fields : String(fields || '').split(','))
    .map((f) => String(f).trim().toUpperCase())
    .filter(Boolean)
  const lines = [
    `SELECT ${cols.length ? cols.join(', ') : '*'}`,
    `  FROM ${String(table || '').trim().toUpperCase()}`,
  ]
  const where = String(whereClause || '').trim().replace(/^where\s+/i, '')
  if (where) lines.push(` WHERE ${where}`)
  return lines.join('\n')
}

/** Best-effort inverse of buildSql. Unparseable SQL yields empty parts. */
export function parseSql(sql) {
  const text = String(sql || '').trim().replace(/;\s*$/, '')
  const m = /^\s*select\s+([\s\S]+?)\s+from\s+([^\s;]+)\s*(?:where\s+([\s\S]+))?$/i.exec(text)
  if (!m) return { table: '', fields: [], whereClause: '' }
  const cols = m[1].trim() === '*' ? [] : m[1].split(',').map((c) => c.trim().toUpperCase()).filter(Boolean)
  return {
    table: m[2].trim().toUpperCase(),
    fields: cols,
    whereClause: (m[3] || '').trim().replace(/\s+/g, ' '),
  }
}

/** All {placeholder} tokens used by a query's WHERE clause / SQL. */
export function placeholdersOf(query) {
  const source = `${query?.whereClause || ''} ${query?.sql || ''}`
  return [...new Set([...source.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]))]
}

/**
 * The {placeholder} tokens the caller must supply for a whole skill document.
 *
 * Every placeholder used by a query, MINUS the ones an earlier query already selects as
 * one of its fields — those are chained in at execution time (step 1 selects ADDRNUMBER
 * from BUT020, step 2 filters ADRC on `ADDRNUMBER = '{addrnumber}'`), so the user never
 * provides them. Comparison is case-insensitive; the returned tokens keep their original
 * casing.
 */
export function requiredPlaceholders(doc) {
  const required = []
  const produced = new Set()
  for (const query of doc?.queries || []) {
    for (const token of placeholdersOf(query)) {
      if (!produced.has(token.toLowerCase()) && !required.includes(token)) required.push(token)
    }
    for (const field of query.fields || []) produced.add(String(field).toLowerCase())
  }
  return required
}

/* ------------------------------------------------------------ frontmatter - */

const needsQuotes = (v) => /^[\s>|&*!%@`{}[\]#-]|[:#]\s|["\n]|\s$/.test(v) || v === ''

function renderFrontmatterValue(value) {
  const v = String(value ?? '').replace(/\s*\n\s*/g, ' ').trim()
  return needsQuotes(v) ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : v
}

function parseFrontmatterValue(raw) {
  const v = String(raw ?? '').trim()
  if ((v.startsWith('"') && v.endsWith('"') && v.length > 1) ||
      (v.startsWith("'") && v.endsWith("'") && v.length > 1)) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return v
}

/* --------------------------------------------------------------- render --- */

/** Normalises a partial doc: defaults, uppercased technical names, derived SQL. */
export function normalizeSkillDoc(doc = {}) {
  const queries = (doc.queries || [])
    .map((q, i) => {
      const table = String(q.table || '').trim().toUpperCase()
      const fields = (Array.isArray(q.fields) ? q.fields : String(q.fields || '').split(','))
        .map((f) => String(f).trim().toUpperCase())
        .filter(Boolean)
      const whereClause = String(q.whereClause || '').trim().replace(/^where\s+/i, '')
      const sql = String(q.sql || '').trim() || buildSql({ table, fields, whereClause })
      const fromSql = table ? null : parseSql(sql)
      return {
        name: String(q.name || `Query ${i + 1}`).trim(),
        description: String(q.description || '').trim(),
        table: table || fromSql?.table || '',
        fields: fields.length ? fields : fromSql?.fields || [],
        whereClause: whereClause || fromSql?.whereClause || '',
        sql,
      }
    })
    .filter((q) => q.sql)

  return {
    name: String(doc.name || '').trim(),
    description: String(doc.description || '').replace(/\s*\n\s*/g, ' ').trim(),
    version: String(doc.version || '1.0.0').trim(),
    lastUpdated: String(doc.lastUpdated || today()).trim(),
    status: String(doc.status || 'draft').trim().toLowerCase(),
    purpose: String(doc.purpose || '').trim(),
    queries,
    returns: String(doc.returns || '').trim(),
  }
}

/** Skill document -> Markdown string (the exact string stored in SkillDescription). */
export function renderSkillMarkdown(input) {
  const doc = normalizeSkillDoc(input)
  const out = ['---']
  for (const [key, label] of FRONTMATTER_ORDER) out.push(`${label}: ${renderFrontmatterValue(doc[key])}`)
  out.push('---', '', `# ${doc.name}`, '')

  out.push(`## ${SECTION_TITLES.purpose}`, '', doc.purpose || '_TODO_', '')

  out.push(`## ${SECTION_TITLES.queries}`, '')
  if (!doc.queries.length) {
    out.push('_TODO_', '')
  } else {
    doc.queries.forEach((q, i) => {
      out.push(`### ${i + 1}. ${q.name}`, '')
      if (q.description) out.push(q.description, '')
      out.push('```sql', q.sql, '```', '')
    })
  }

  out.push(`## ${SECTION_TITLES.returns}`, '', doc.returns || '_TODO_', '')

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/* ---------------------------------------------------------------- parse --- */

function splitFrontmatter(md) {
  const text = String(md || '').replace(/^﻿/, '').replace(/\r\n/g, '\n')
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text)
  if (!m) return { meta: {}, body: text }
  const meta = {}
  for (const line of m[1].split('\n')) {
    const kv = /^([^:#][^:]*):\s*(.*)$/.exec(line)
    if (!kv) continue
    const key = FRONTMATTER_ALIASES[fold(kv[1])]
    if (key) meta[key] = parseFrontmatterValue(kv[2])
  }
  return { meta, body: text.slice(m[0].length) }
}

/** Splits body into { headingLevel, title, lines } blocks, ignoring fenced code. */
function splitHeadings(body) {
  const blocks = []
  let current = { level: 0, title: '', lines: [] }
  let fence = null
  for (const line of body.split('\n')) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line)
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0]
      else if (fenceMatch[1][0] === fence) fence = null
      current.lines.push(line)
      continue
    }
    const heading = !fence && /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push(current)
      current = { level: heading[1].length, title: heading[2].trim(), lines: [] }
    } else {
      current.lines.push(line)
    }
  }
  blocks.push(current)
  return blocks
}

const trimBlock = (lines) => lines.join('\n').replace(/^\n+|\n+$/g, '').trim()

function sectionKey(title) {
  const folded = fold(title)
  for (const [key, aliases] of Object.entries(SECTION_ALIASES)) {
    if (aliases.includes(folded)) return key
  }
  return null
}

/** Splits the ## Query section into individual queries (### blocks, or one anonymous). */
function parseQueries(blocks) {
  const queries = []
  for (const block of blocks) {
    const raw = trimBlock(block.lines)
    const fences = [...raw.matchAll(/^[ \t]*(?:```+|~~~+)[ \t]*(\w+)?[ \t]*\n([\s\S]*?)^[ \t]*(?:```+|~~~+)[ \t]*$/gm)]
    const sql = fences.map((f) => f[2].trim()).filter(Boolean).join('\n\n')
    const description = raw
      .replace(/^[ \t]*(?:```+|~~~+)[\s\S]*?^[ \t]*(?:```+|~~~+)[ \t]*$/gm, '')
      .replace(/\n{2,}/g, '\n\n')
      .trim()
    if (!sql && !description) continue
    const name = String(block.title || '').replace(/^\d+[.)]\s*/, '').trim()
    queries.push({ name: name || `Query ${queries.length + 1}`, description, sql, ...parseSql(sql) })
  }
  return queries
}

/**
 * Markdown string -> skill document. Lenient: missing sections come back empty,
 * so combine with validateSkillDoc() before trusting the result.
 */
export function parseSkillMarkdown(md) {
  const { meta, body } = splitFrontmatter(md)
  const blocks = splitHeadings(body)

  const h1 = blocks.find((b) => b.level === 1)
  const sections = { purpose: [], queries: [], returns: [] }
  let currentKey = null
  for (const block of blocks) {
    if (block.level === 1 || block.level === 0) { currentKey = null; continue }
    if (block.level === 2) {
      currentKey = sectionKey(block.title)
      if (currentKey) sections[currentKey].push(block)
      continue
    }
    if (currentKey) sections[currentKey].push(block)
  }

  return normalizeSkillDoc({
    name: h1?.title || meta.name || '',
    description: meta.description || '',
    version: meta.version,
    lastUpdated: meta.lastUpdated,
    status: meta.status,
    purpose: sections.purpose.map((b) => trimBlock(b.lines)).filter(Boolean).join('\n\n'),
    queries: parseQueries(sections.queries),
    returns: sections.returns.map((b) => trimBlock(b.lines)).filter(Boolean).join('\n\n'),
  })
}

/* -------------------------------------------------------------- version --- */

const versionParts = (version) => {
  const parts = String(version || '')
    .trim()
    .split('.')
    .map((p) => parseInt(p, 10))
  return [0, 1, 2].map((i) => (Number.isFinite(parts[i]) ? parts[i] : 0))
}

/** -1 / 0 / 1, comparing major.minor.patch numerically. */
export function compareVersions(a, b) {
  const left = versionParts(a)
  const right = versionParts(b)
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1
  }
  return 0
}

/** '1.0.0' -> '1.1.0' (minor, the default) or '1.0.1' (patch). */
export function bumpVersion(version, level = 'minor') {
  const [major, minor, patch] = versionParts(version)
  if (level === 'major') return `${major + 1}.0.0`
  if (level === 'patch') return `${major}.${minor}.${patch + 1}`
  return `${major}.${minor + 1}.0`
}

/** Today in YYYY-MM-DD, the format `last_updated` uses. */
export const todayStamp = () => today()

/* ------------------------------------------------------------- validate --- */

/** Returns a list of human-readable problems; empty means the doc is usable. */
export function validateSkillDoc(doc) {
  const d = normalizeSkillDoc(doc)
  const problems = []
  if (!d.name) problems.push('missing skill name (# heading / frontmatter name)')
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(d.name || 'x')) problems.push(`skill name "${d.name}" is not PascalCase`)
  if (!d.description) problems.push('missing frontmatter description')
  if (!SKILL_STATUS.includes(d.status)) problems.push(`status "${d.status}" is not one of ${SKILL_STATUS.join(', ')}`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.lastUpdated)) problems.push(`last_updated "${d.lastUpdated}" is not YYYY-MM-DD`)
  if (!d.purpose) problems.push(`empty "${SECTION_TITLES.purpose}" section`)
  if (!d.returns) problems.push(`empty "${SECTION_TITLES.returns}" section`)
  if (!d.queries.length) problems.push(`empty "${SECTION_TITLES.queries}" section`)
  d.queries.forEach((q, i) => {
    if (!q.table) problems.push(`query ${i + 1} ("${q.name}") has no resolvable table`)
    if (!q.fields.length) problems.push(`query ${i + 1} ("${q.name}") selects no fields`)
  })
  return problems
}
