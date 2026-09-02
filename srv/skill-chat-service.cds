using { kip.skills.SkillDoc } from './skill-types';

/**
 * UI-facing façade for the chat app (app/chat).
 *
 * Commands and plain chat NEVER write to SAP – they only produce drafts. Saving and
 * deleting happen exclusively through `saveSkill` / `confirmDelete`, which the UI calls
 * when the user clicks the button on the card.
 *
 * A plain message with no draft open is a data request: it goes to SkillRoutingService,
 * which answers only out of the stored skills.
 *
 * Never talks to SAP or the LLM directly: it delegates to SkillAuthoringService
 * (generate) and SkillRepositoryService (find / persist / delete).
 */
service SkillChatService @(path: '/skill-chat') {

  /** A slash command offered by the input's autocomplete. */
  type ChatCommand {
    name        : String;   // '/create-skill'
    args        : String;   // '<description>'
    description : String;
    example     : String;
  }

  /** One of several skills matching an ambiguous request. */
  type SkillCandidate {
    name        : String;
    description : String;
    version     : String;
    status      : String;
  }

  /**
   * What the UI knows about the document currently open in this chat.
   * `markdown` is the text as the user last edited it, so revisions build on the edits.
   */
  type ChatContext {
    markdown      : String;
    name          : String;
    mode          : String;   // 'create' | 'update' | 'delete' | 'route' | ''   // 'create' | 'update'
    storedVersion : String;   // version currently in SAP, empty for a new skill
  }

  type ChatReply {
    role          : String;   // always 'assistant'
    kind          : String;   // 'text' | 'skill' | 'route' | 'delete' | 'choice' | 'error'
    /** Markdown shown in the assistant bubble. */
    text          : String;
    /** The recognised slash command, or '' for plain chat. */
    command       : String;
    /** Buttons the card should offer: 'save' | 'delete'. */
    actions       : many String;
    /** The skill document, when there is one. */
    markdown      : String;
    skill         : SkillDoc;
    parameters    : many String;
    /** Carried back into the next turn's ChatContext. */
    mode          : String;   // 'create' | 'update' | 'delete' | 'route' | ''
    target        : String;
    storedVersion : String;
    /** Set for kind = 'choice'. */
    candidates    : many SkillCandidate;
    /** True only after a write actually reached SAP. */
    saved         : Boolean;
    error         : String;
  }

  /** One turn of the conversation. Never writes to SAP. */
  action chat(message : String, context : ChatContext) returns ChatReply;

  /**
   * Writes the document to SAP – the "Save skill" button.
   * `mode` 'create' posts a new skill, 'update' replaces the stored one and bumps
   * its version; `last_updated` is always set to today.
   */
  action saveSkill(markdown : String, mode : String, name : String, storedVersion : String) returns ChatReply;

  /** Deletes a stored skill – the "Delete skill" button. */
  action confirmDelete(name : String) returns ChatReply;

  /** The commands the input should suggest – single source of truth for the UI. */
  function commands() returns many ChatCommand;

  /** Stored skill names, for the `/list-skills <name>` argument autocomplete. */
  function skillNames() returns many String;
}
