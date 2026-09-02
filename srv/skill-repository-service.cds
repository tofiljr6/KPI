using { kip.skills.SkillInput, kip.skills.SkillDoc } from './skill-types';

/**
 * The only service that talks to the SAP on-premise system.
 * Bridges to the ABAP OData service ZXXXX_SKILL_SRV via destination SA1_300.
 *
 *   GET  /sap/opu/odata/sap/ZXXXX_SKILL_SRV/SkillSet          -> all skills
 *   GET  /sap/opu/odata/sap/ZXXXX_SKILL_SRV/SkillSet('<id>')  -> single skill
 *   POST /sap/opu/odata/sap/ZXXXX_SKILL_SRV/SkillSet          -> create skill
 *   POST /sap/opu/odata/sap/ZXXXX_SKILL_SRV/QuerySet          -> run one SELECT, get rows
 */
service SkillRepositoryService @(path: '/skill-repository') {

  /** A stored skill with its Markdown document parsed back into fields. */
  type StoredSkill {
    SkillName        : String;
    SkillTriggerText : String;
    QueryTable       : String;
    markdown         : String;
    doc              : SkillDoc;
    /** Set when the stored string could not be parsed as a skill document. */
    parseWarnings    : many String;
    /** How this record matched a findSkills query: 'exact' | 'partial' | ''. */
    match            : String;
  }

  /** Raw response from SkillSet (list). */
  function getSkills() returns String;

  /** Raw response from SkillSet('<id>') (single skill). */
  function getSkill(id : String) returns String;

  /** SkillSet('<id>') with SkillDescription parsed from Markdown into a SkillDoc. */
  function getSkillDoc(id : String) returns StoredSkill;

  /** SkillSet, every entry parsed from Markdown into a SkillDoc. */
  function getSkillDocs() returns many StoredSkill;

  /**
   * Resolves a name or a free-text description to stored skills, best match first.
   * An 'exact' match means the name matched; everything else is 'partial'.
   */
  function findSkills(query : String) returns many StoredSkill;

  /** Creates a skill (POST SkillSet). Returns the raw created entity. */
  action createSkill(skill : SkillInput) returns String;

  /** Replaces a stored skill (PUT), addressed by its name. */
  action updateSkill(name : String, skill : SkillInput) returns String;

  /** Deletes a stored skill (DELETE), addressed by its name. */
  action deleteSkill(name : String) returns String;

  /**
   * Runs one single-table SELECT through the ABAP QuerySet entity and returns the raw
   * backend JSON. `Fields` is a comma-separated field list; `MaxRows` is optional (the
   * backend caps at 100 when omitted). This is the only data path that is not about
   * skills themselves.
   */
  action runQuery(TableName : String, Fields : String, WhereClause : String, MaxRows : Integer) returns String;
}
