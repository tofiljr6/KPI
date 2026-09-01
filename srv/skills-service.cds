/**
 * Connection test for the ABAP REST API exposed via destination SA1_300.
 * Raw read only for now; LangChain comes later.
 *
 * ABAP:
 *   GET /sap/bc/zxxx_skills        -> all skills
 *   GET /sap/bc/zxxx_skills/{id}   -> single skill
 */
service SkillsService {

  /** Raw response from /sap/bc/zxxx_skills (list). */
  function getSkills() returns String;

  /** Raw response from /sap/bc/zxxx_skills/{id} (single skill). */
  function getSkill(id : String) returns String;
}
