namespace kip.skills;

/** Shape of a skill in the ABAP OData service (ZXXXX_SKILL_SRV / SkillSet). */
type SkillInput {
  SkillName        : String;
  SkillDescription : String;
  SkillTriggerText : String;
  QueryTable       : String;
  QueryFields      : String;
  QueryWhere       : String;
}
