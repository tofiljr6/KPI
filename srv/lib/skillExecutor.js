/**
 * Skill query -> the payload for the ABAP QuerySet entity, and the QuerySet response
 * back into plain rows.
 *
 *   { table: 'BUT000', fields: ['PARTNER', 'TYPE'], whereClause: "PARTNER = '{partner}'" }
 *   + { partner: '5' }
 *   -> { TableName: 'BUT000', Fields: 'PARTNER, TYPE', WhereClause: "PARTNER = '0000000005'" }
 *
 * Every skill query is a single-table SELECT (SAP QuerySet has no JOIN). A skill that
 * spans tables has one query step per table; SkillExecutionService runs them in order and
 * feeds each step's result into the next via `harvestValues`.
 */

/**
 * Key fields SAP stores zero-padded (ALPHA conversion). A purely numeric value shorter
 * than the field width is left-padded here, so "5" finds partner "0000000005". Anything
 * non-numeric is left untouched. Extend the map as more identifiers show up.
 */
export const ID_FIELD_WIDTH = {
  PARTNER: 10, KUNNR: 10, LIFNR: 10, KUNN2: 10, LIFN2: 10,
  GPART: 10, LIFRE: 10, KONZS: 10, EMPFB: 10, EMPGE: 10,
  MATNR: 18, EQUNR: 18,
}

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/**
 * How field names are joined in the `Fields` string. The backend requires a space
 * between names ("PARTNER, IDNUMBER", never "PARTNER,IDNUMBER").
 */
export const FIELD_SEPARATOR = ', '

/** The field a `{name}` token is compared against in a WHERE clause, upper-cased. */
export function fieldForPlaceholder(whereClause, name) {
  const re = new RegExp(
    `([A-Za-z_][A-Za-z0-9_]*)\\s*(?:=|<>|>=|<=|>|<|\\bEQ\\b|\\bNE\\b|\\bLIKE\\b)\\s*'?\\{${name}\\}`,
    'i'
  )
  const m = re.exec(String(whereClause || ''))
  return m ? m[1].toUpperCase() : ''
}

/** Left-pads a purely numeric id to its SAP field width. Everything else is unchanged. */
export function normalizeIdValue(field, value) {
  const v = String(value ?? '').trim()
  const width = ID_FIELD_WIDTH[String(field || '').toUpperCase()]
  if (width && /^\d+$/.test(v) && v.length < width) return v.padStart(width, '0')
  return v
}

/** Substitutes `{placeholder}` tokens in a WHERE clause with the request's values. */
export function fillWhereClause(whereClause, values = {}) {
  const clause = String(whereClause || '')
  return clause.replace(PLACEHOLDER, (whole, name) => {
    const raw = values[name]
    if (raw == null || String(raw).trim() === '') return whole
    const field = fieldForPlaceholder(clause, name)
    // The token already sits inside the clause's own quoting (FIELD = '{x}'); only the
    // value goes in, with single quotes doubled so it cannot break out of the literal.
    return normalizeIdValue(field, raw).replace(/'/g, "''")
  })
}

/** Skill query + request values -> the QuerySet payload. */
export function buildQueryPayload(query, values = {}, { maxRows } = {}) {
  const fields = (Array.isArray(query?.fields) ? query.fields : String(query?.fields || '').split(','))
    .map((f) => String(f).trim().toUpperCase())
    .filter(Boolean)

  const payload = {
    TableName: String(query?.table || '').trim().toUpperCase(),
    Fields: fields.join(FIELD_SEPARATOR),
    WhereClause: fillWhereClause(query?.whereClause, values),
  }
  if (Number.isInteger(maxRows) && maxRows > 0) payload.MaxRows = maxRows
  return payload
}

/**
 * A step's result as a `{ columnLowercased: value }` map from its FIRST row, so a later
 * step can fill a `{placeholder}` named after that column (e.g. `{addrnumber}` from a
 * BUT020 step feeds the ADRC step). Blank values are skipped.
 */
export function harvestValues(rows) {
  const first = Array.isArray(rows) && rows[0] && typeof rows[0] === 'object' ? rows[0] : {}
  const out = {}
  for (const [key, value] of Object.entries(first)) {
    if (value != null && String(value).trim() !== '') out[key.toLowerCase()] = String(value).trim()
  }
  return out
}

/** Drops the OData V2 `__metadata` wrapper from a row. */
export function stripMeta(row) {
  if (!row || typeof row !== 'object') return row
  const { __metadata, ...rest } = row
  return rest
}

const normalizeRows = (list) =>
  (Array.isArray(list) ? list : [])
    .map(stripMeta)
    .filter((r) => r && typeof r === 'object' && Object.keys(r).length)

/**
 * QuerySet response (string or object) -> plain result rows.
 *
 * The QuerySet entity returns the rows as a JSON string in the `result` property; that
 * is the primary path. Falls back to the OData V2 feed shape
 * (`{ d: { results: [...] } }`), a bare array or a single entity.
 */
export function extractRows(raw) {
  let body
  try {
    body = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return []
  }
  const d = body?.d ?? body

  const packed = d?.result ?? d?.Result
  if (typeof packed === 'string') {
    try {
      const parsed = JSON.parse(packed)
      return normalizeRows(Array.isArray(parsed) ? parsed : [parsed])
    } catch {
      return []
    }
  }
  if (packed && typeof packed === 'object') {
    return normalizeRows(Array.isArray(packed) ? packed : [packed])
  }

  const list = Array.isArray(d?.results)
    ? d.results
    : Array.isArray(d)
      ? d
      : d && typeof d === 'object'
        ? [d]
        : []
  return normalizeRows(list)
}
