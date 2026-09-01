/**
 * Reads/writes skills from the ABAP OData service via destination SA1_300.
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

  /** Raw response from SkillSet (list). */
  function getSkills() returns String;

  /** Raw response from SkillSet('<id>') (single skill). */
  function getSkill(id : String) returns String;

  /** Creates a skill (POST SkillSet). Returns the raw created entity. */
  action createSkill(skill : SkillInput) returns String;
}
