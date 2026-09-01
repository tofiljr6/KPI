using { kip.skills.SkillInput } from './skill-types';

/**
 * The only service that talks to the SAP on-premise system.
 * Bridges to the ABAP OData service ZXXXX_SKILL_SRV via destination SA1_300.
 *
 *   GET  /sap/opu/odata/sap/ZXXXX_SKILL_SRV/SkillSet          -> all skills
 *   GET  /sap/opu/odata/sap/ZXXXX_SKILL_SRV/SkillSet('<id>')  -> single skill
 *   POST /sap/opu/odata/sap/ZXXXX_SKILL_SRV/SkillSet          -> create skill
 */
service SkillRepositoryService @(path: '/skill-repository') {

  /** Raw response from SkillSet (list). */
  function getSkills() returns String;

  /** Raw response from SkillSet('<id>') (single skill). */
  function getSkill(id : String) returns String;

  /** Creates a skill (POST SkillSet). Returns the raw created entity. */
  action createSkill(skill : SkillInput) returns String;
}
