# SkillRoutingService — answering out of the repository

Base path: `/skill-routing` · [`srv/skill-routing-service.cds`](../srv/skill-routing-service.cds) ·
[`srv/skill-routing-service.js`](../srv/skill-routing-service.js) →
[`srv/lib/skillRouter.js`](../srv/lib/skillRouter.js)

A plain question in the chat — no slash command, no draft open — is a data request.
This service answers it with **one stored skill**, or with "I do not know how to do that".

```
"I would like the email address of partner 771"
  → GetBusinessPartnerEmail   {partner} = 771
```

Picking the skill is all this service does. Running the chosen skill's `SELECT` is a
separate step, handled by [`SkillExecutionService`](skill-execution.md) — the chat calls
it right after a match, once every `{placeholder}` has a value.

## Why it cannot answer from its own knowledge

The model knows plenty about SAP tables — and that is exactly what must not leak into the
answer. Two things prevent it:

1. **Every stored skill becomes a tool.** `getSkillDocs()` loads the repository, and each
   skill turns into an OpenAI tool: its name, a description built from the document
   (`description`, trigger text, purpose, the tables it reads), and one string parameter
   per `{placeholder}` the caller must supply — `requiredPlaceholders` excludes the ones a
   later query step gets from an earlier step (a chained multi-table skill only asks for
   the first step's key).
2. **The model must call one** — `tool_choice: 'required'`. It cannot reply with prose, so
   it cannot answer the question itself. Alongside the skills it gets one more tool,
   `no_matching_skill(missing)`, which is the only way to say "nothing here fits". The
   system prompt states that calling it is the correct answer, not a failure.

So the reply is always either a skill that exists in SAP, or an explicit refusal. There is
no third path where the model writes its own SELECT.

Four further guards live in `routeQuestion`:

- an **empty repository** short-circuits before the model is called at all;
- a **tool name that is not a stored skill** (a hallucinated one) is refused, not passed off
  as a match;
- **no tool call at all** counts as "I do not know";
- parameters are only kept when they carry a value — the prompt forbids inventing an
  identifier, and whatever is missing comes back in `missing` for the caller to supply.

## Endpoint

`POST /skill-routing/route` with `{ "question": "..." }` returns a `SkillRoute`:

| Field | Meaning |
|---|---|
| `matched` | whether a stored skill covers the request |
| `skillName`, `skill` | the chosen skill and its parsed document |
| `parameters` | `[{ name, value }]` — required placeholder values taken from the request |
| `missing` | required placeholders the caller still has to supply (chained ones excluded) |
| `reason` | why nothing matched, when `matched` is false |
| `considered` | how many skills were offered to the model |

`parameters` and `missing` feed straight into [`SkillExecutionService.runSkill`](skill-execution.md):
a match with an empty `missing` is run immediately; otherwise the caller has to supply the
rest first.

## Testing

```bash
# wiring, offline: tool definitions and how each possible answer is interpreted
npm run test:router

# the real thing – needs OPENAI_API_KEY, no SAP required
node --env-file=.env scripts/test-skill-routing-live.js
node --env-file=.env scripts/test-skill-routing-live.js "your own question"
```

The live script runs a fixed set of three skills against eight questions — four that a
skill covers and four that none does (a phone number, a bank account, the capital of
France, a list of sales orders) — and reports the routing accuracy. The four negatives are
the point: they are what catches a model that starts answering from its own knowledge.
