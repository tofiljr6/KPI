using { kip.skills.SkillInput, kip.skills.SkillDoc } from './skill-types';

/**
 * Turns a natural-language data request into a skill document (Markdown, LLM).
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
    /** The skill document as a Markdown string – exactly what is stored. */
    markdown    : String;
    /** The same document, parsed into fields. */
    doc         : SkillDoc;
    /** ABAP payload (SkillDescription = markdown). Null when generation failed. */
    skill       : SkillInput;
    /** {placeholder} tokens the caller has to supply at runtime. */
    parameters  : many String;
    reasoning   : String;
    tableChoice : TableChoice;
    error       : String;
  }

  /**
   * Natural-language -> skill document. Does NOT persist anything.
   * Example query: "chcę dostać dane adresowe partnera".
   * `status` defaults to 'draft', `version` to '1.0.0'.
   */
  action generateSkill(query : String, version : String, status : String) returns GeneratedSkill;

  /**
   * generateSkill + SkillRepositoryService.createSkill in one call.
   * Returns the raw created entity, or the draft JSON (with `error`) on failure.
   */
  action generateAndCreateSkill(query : String, version : String, status : String) returns String;

  /** Markdown string -> structured document (the string->Markdown mapping). */
  action parseSkillMarkdown(markdown : String) returns SkillDoc;

  /** Structured document -> Markdown string (the Markdown->string mapping). */
  action renderSkillMarkdown(doc : SkillDoc) returns String;
}
