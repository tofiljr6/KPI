# Skill document format (Markdown ⇄ string)

A skill is authored as **one Markdown document** — the shape Claude's `skill-create`
produces — and persisted in SAP as a **plain string in `SkillDescription`**.
Implementation: [`srv/lib/skillMarkdown.js`](../srv/lib/skillMarkdown.js).

## The format

````markdown
---
name: GetBusinessPartnerAddress
description: "Zwraca dane adresowe partnera biznesowego: miasto, ulicę i kod pocztowy."
version: 1.0.0
last_updated: 2026-09-02
status: draft
---

# GetBusinessPartnerAddress

## Cel tego skilla

Skill odpowiada na pytania o **adres partnera biznesowego**.

- wymaga numeru partnera (`PARTNER`)
- nie zwraca danych bankowych ani identyfikatorów

## Query

### 1. Numer adresu partnera

Mapuje PARTNER na ADDRNUMBER. Potrzebuje {partner}.

```sql
SELECT PARTNER, ADDRNUMBER, ADR_KIND
  FROM BUT020
 WHERE PARTNER = '{partner}'
```

### 2. Dane adresowe

Właściwy adres z ADRC, dla {addrnumber} z kroku 1.

```sql
SELECT ADDRNUMBER, NAME1, CITY1, POST_CODE1, STREET
  FROM ADRC
 WHERE ADDRNUMBER = '{addrnumber}'
```

## Rückgabe

Jeden wiersz na adres:

| Pole | Znaczenie |
|---|---|
| CITY1 | Miasto |
| STREET | Ulica |

Pusty wynik = partner nie ma adresu.
````

- **Frontmatter** — `name`, `description`, `version`, `last_updated` (`YYYY-MM-DD`),
  `status` (`draft` \| `active` \| `deprecated`). Values are quoted only when they need it.
- **`# heading`** — the skill name, PascalCase; wins over `name:` when the two differ.
- **`## Cel tego skilla`** — what the skill answers, what it does not cover, which
  identifier the caller must have.
- **`## Query`** — one `### n. Name` block per **single-table SELECT** (1–4), each with a
  short description and one ` ```sql ` block. Runtime values are `{placeholder}` tokens.
- **`## Rückgabe`** — the result shape: a column table, cardinality, meaning of an empty result.

## API

```js
import {
  renderSkillMarkdown,   // doc  -> Markdown string   (what goes into the DB)
  parseSkillMarkdown,    // string -> doc             (what comes back out)
  validateSkillDoc,      // doc  -> string[] of problems ([] = usable)
  buildSql, parseSql,    // { table, fields, whereClause } <-> formatted SELECT
  placeholdersOf,        // query -> ['partner', ...]
} from './srv/lib/skillMarkdown.js'
```

The document object:

```js
{
  name, description, version, lastUpdated, status,   // frontmatter
  purpose,                                           // ## Cel tego skilla
  queries: [{ name, description, table, fields: [], whereClause, sql }],
  returns,                                           // ## Rückgabe
}
```

`render → parse → render` is **stable** — that is what `scripts/test-skill-markdown.js`
asserts. `normalizeSkillDoc` fills the defaults (`version 1.0.0`, today's date, `draft`),
uppercases table/field names and derives `sql` from `table`/`fields`/`whereClause` when
it is missing. The `WHERE` clause is kept **verbatim** — uppercasing it would break
`{placeholders}` and string literals.

The parser is deliberately lenient, so hand-edited documents still load:

| Section | Also accepted |
|---|---|
| `## Cel tego skilla` | `## Cel`, `## Purpose`, `## Goal`, `## Ziel` |
| `## Query` | `## Queries`, `## Zapytania`, `## SQL`, `## Abfragen` |
| `## Rückgabe` | `## Ruckgabe`, `## Return`, `## Output`, `## Wynik`, `## Zwrotka` |

`last updated` / `last-updated` / `updated` are accepted for `last_updated`. `###`
numbering is optional, free-form SQL is kept as-is (`table`/`fields` are then parsed out
best-effort, and are empty if the SQL is not a plain `SELECT ... FROM ... WHERE ...`).
Re-rendering a hand-written document normalises it back to the canonical form.

## Mapping onto the ABAP record

[`srv/lib/skillAgent.js`](../srv/lib/skillAgent.js) exports both directions:

| `SkillInput` field | Value |
|---|---|
| `SkillName` | `doc.name` |
| **`SkillDescription`** | **the entire Markdown document as a string** |
| `SkillTriggerText` | "Use this skill when the user asks for …" |
| `QueryTable` / `QueryFields` / `QueryWhere` | mirror of **the first query** (kept for backwards compatibility) |

```js
toSkillInput(doc, { trigger })  // doc    -> ABAP payload
fromSkillInput(record)          // record -> { markdown, doc, trigger }
```

A record written before this format still parses: `fromSkillInput` falls back to the
flat fields, and `validateSkillDoc` reports the missing sections.

## Testing

```bash
node scripts/test-skill-markdown.js
```

Offline (no LLM, no SAP): round-trip stability, a hand-written document with EN/DE
headings and unnumbered queries, normalisation, and the ABAP record mapping.
