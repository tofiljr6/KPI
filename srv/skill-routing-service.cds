using { kip.skills.SkillDoc } from './skill-types';

/**
 * Picks the stored skill that answers a data request.
 *
 * Every skill in the repository is handed to the model as a tool and it must call
 * exactly one of them – or the explicit "none of these fit" tool. It therefore can
 * only answer out of the skill repository, never out of its own SAP knowledge.
 *
 * Running the chosen skill's SELECT is a separate, later step.
 */
service SkillRoutingService @(path: '/skill-routing') {

  type RouteParameter {
    name  : String;
    /** Value taken verbatim from the request. */
    value : String;
  }

  type SkillRoute {
    question   : String;
    /** True when a stored skill covers the request. */
    matched    : Boolean;
    skillName  : String;
    skill      : SkillDoc;
    /** Placeholder values the request already supplies. */
    parameters : many RouteParameter;
    /** Placeholders the caller still has to provide. */
    missing    : many String;
    /** Why nothing matched, when `matched` is false. */
    reason     : String;
    /** How many skills were offered to the model. */
    considered : Integer;
    error      : String;
  }

  /** Data request -> the one stored skill that answers it, or `matched: false`. */
  action route(question : String) returns SkillRoute;
}
