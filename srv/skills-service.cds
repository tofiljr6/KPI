/**
 * Reads/writes skills from the ABAP OData service via destination SA1_300,
 * and generates new skill definitions from a natural-language request
 * (LangGraph flow: plan search -> web search -> draft skill).
 *
 * Backend (OData V2, SAP Gateway):
 *   GET  /sap/opu/odata/sap/ZXXXX_SKILL_SRV/SkillSet          -> all skills
 *   GET  /sap/opu/odata/sap/ZXXXX_SKILL_SRV/SkillSet('<id>')  -> single skill
 *   POST /sap/opu/odata/sap/ZXXXX_SKILL_SRV/SkillSet          -> create skill
 */
service SkillsService {

  type SkillInput {
    SkillName        : String;
    SkillDescription : String;
    SkillTriggerText : String;
    QueryTable       : String;
    QueryFields      : String;
    QueryWhere       : String;
  }

  type SkillSource {
    title : String;
    url   : String;
  }

  type SkillDraft {
    query     : String;
    skill     : SkillInput;
    reasoning : String;
    sources   : many SkillSource;
    error     : String;
  }

  /** Raw response from SkillSet (list). */
  function getSkills() returns String;

  /** Raw response from SkillSet('<id>') (single skill). */
  function getSkill(id : String) returns String;

  /** Creates a skill (POST SkillSet). Returns the raw created entity. */
  action createSkill(skill : SkillInput) returns String;

  /**
   * Natural-language -> skill definition. SAP expert prompt; falls back to a
   * keyless web search when the model is unsure of the table/fields.
   * Does NOT persist anything. Example query: "chcę dostać dane adresowe partnera".
   */
  action generateSkill(query : String) returns SkillDraft;

  /**
   * generateSkill + createSkill in one call. Returns the raw created entity,
   * or the draft (with `error`) when generation fails.
   */
  action generateAndCreateSkill(query : String) returns String;
}
