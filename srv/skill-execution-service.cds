/**
 * Runs a stored skill: takes the skill picked by SkillRoutingService plus the parameter
 * values from the request, fills the skill's SELECT(s) and executes them against SAP
 * through SkillRepositoryService.runQuery (the ABAP QuerySet entity).
 *
 * Every skill query is a single-table SELECT (QuerySet has no JOIN). A skill that spans
 * tables has one query step per table: the steps run in order and each step's first row
 * feeds the next step's {placeholder}s (BUT020 -> ADDRNUMBER -> ADRC).
 *
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
    /** True once at least one step ran. */
    ran       : Boolean;
    /** The LAST step that ran, as sent to QuerySet (the step that holds the answer data). */
    table       : String;
    fields      : String;
    /** WHERE clause with the placeholder values substituted. */
    whereClause : String;
    maxRows     : Integer;
    /** The JSON body posted for the FIRST step. */
    requestJson : LargeString;
    /** Rows of the last step. */
    rowCount  : Integer;
    columns   : many String;
    /** Last step's rows as a JSON array of objects (columns are dynamic). */
    rowsJson  : LargeString;
    /** Per-step summary: [{ name, table, whereClause, rowCount }] — one entry per step that ran. */
    stepsJson : LargeString;
    /**
     * The result formatted into the answer, following the skill's `## Return` section.
     * Empty when the formatting step failed – the chat then falls back to a raw table.
     */
    answer    : LargeString;
    /** Placeholders the caller still owes, when `ran` is false. */
    missing   : many String;
    /** Set when some but not all steps ran (a step returned nothing / failed). `ran` stays true. */
    note      : String;
    error     : String;
  }

  /**
   * Run `skillName`'s query steps in order, filling placeholders from `parameters` and
   * from each step's result, then format everything into `answer` using the skill's
   * `## Return` section and the original `question`.
   */
  action runSkill(question : String, skillName : String, parameters : many ParamValue, maxRows : Integer) returns SkillRun;
}
