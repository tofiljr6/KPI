namespace kip.skills;

/**
 * Shape of a skill in the ABAP OData service (ZXXXX_SKILL_SRV / SkillSet).
 * `SkillDescription` carries the whole skill document as a Markdown string
 * (see docs/skill-markdown.md); the Query* fields mirror the first query
 * of that document for backwards compatibility.
 */
type SkillInput {
  SkillName        : String;
  SkillDescription : String;
  SkillTriggerText : String;
  QueryTable       : String;
  QueryFields      : String;
  QueryWhere       : String;
}

/** One single-table SELECT inside a skill document (## Query section). */
type SkillQuery {
  name        : String;
  description : String;
  table       : String;
  fields      : many String;
  whereClause : String;
  sql         : String;
}

/** The structured form of the Markdown skill document. */
type SkillDoc {
  name        : String;
  description : String;
  version     : String;
  lastUpdated : String;
  status      : String;
  purpose     : String;
  queries     : many SkillQuery;
  returns     : String;
}
