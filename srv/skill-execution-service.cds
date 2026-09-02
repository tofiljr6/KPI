/**
 * Runs a stored skill: takes the skill picked by SkillRoutingService plus the parameter
 * values from the request, fills the skill's SELECT and executes it against SAP through
 * SkillRepositoryService.runQuery (the ABAP QuerySet entity).
 *
 * A skill query is a single-table SELECT; multi-step skills run step 1 only for now.
 * Known key fields (PARTNER, KUNNR, LIFNR, MATNR, ...) get their numeric values
 * left-padded with zeros so "5" matches "0000000005".
 *
 * Never talks to SAP directly – it delegates to SkillRepositoryService.
 */
service SkillExecutionService @(path: '/skill-execution') {

  type ParamValue {
    name  : String;
    value : String;
  }

  type SkillRun {
    skillName : String;
    /** True only when the SELECT actually ran. */
    ran       : Boolean;
    /** The first query of the skill, as sent to QuerySet. */
    table       : String;
    fields      : String;
    /** WHERE clause with the placeholder values substituted. */
    whereClause : String;
    maxRows     : Integer;
    rowCount  : Integer;
    columns   : many String;
    /** Result rows as a JSON array of objects (columns are dynamic). */
    rowsJson  : LargeString;
    /** Placeholders that still had no value, when `ran` is false. */
    missing   : many String;
    error     : String;
  }

  /** Run the first query of `skillName`, filling its placeholders from `parameters`. */
  action runSkill(skillName : String, parameters : many ParamValue, maxRows : Integer) returns SkillRun;
}
