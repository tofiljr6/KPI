using { kip.skills.SkillInput } from './skill-types';

/**
 * Turns a natural-language data request into a skill definition (LLM + web search).
 * Does not talk to SAP directly – for persistence it calls SkillRepositoryService.
 */
service SkillAuthoringService @(path: '/skill-authoring') {

  type TableChoice {
    table           : String;
    keyField        : String;
    candidateFields : many String;
    confidence      : String;
    alternatives    : many String;
    notes           : String;
  }

  type GeneratedSkill {
    query       : String;
    skill       : SkillInput;
    reasoning   : String;
    tableChoice : TableChoice;
    error       : String;
  }

  /**
   * Natural-language -> skill definition. Does NOT persist anything.
   * Example query: "chcę dostać dane adresowe partnera".
   */
  action generateSkill(query : String) returns GeneratedSkill;

  /**
   * generateSkill + SkillRepositoryService.createSkill in one call.
   * Returns the raw created entity, or the draft JSON (with `error`) on failure.
   */
  action generateAndCreateSkill(query : String) returns String;
}
