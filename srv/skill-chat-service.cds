using { kip.skills.SkillDoc } from './skill-types';

/**
 * UI-facing façade for the chat app (app/chat).
 * Plain chat does nothing on its own – only slash commands act.
 * Never talks to SAP or the LLM directly: it delegates to
 * SkillAuthoringService (generate) and SkillRepositoryService (persist).
 */
service SkillChatService @(path: '/skill-chat') {

  /** A slash command offered by the input's autocomplete. */
  type ChatCommand {
    name        : String;   // '/create-skill'
    args        : String;   // '<opis danych>'
    description : String;
    example     : String;
  }

  type ChatReply {
    role       : String;         // always 'assistant'
    kind       : String;         // 'text' | 'skill' | 'error'
    /** Markdown shown in the assistant bubble. */
    text       : String;
    /** The recognised slash command, or '' for plain chat. */
    command    : String;
    /** Set when a skill was generated: the document, rendered and parsed. */
    markdown   : String;
    skill      : SkillDoc;
    parameters : many String;
    /** True when the skill reached SAP. */
    saved      : Boolean;
    error      : String;
  }

  /** One turn of the conversation. */
  action chat(message : String) returns ChatReply;

  /** The commands the input should suggest – single source of truth for the UI. */
  function commands() returns many ChatCommand;
}
