# Knowledge pack

What the agents know before they start, so no app re-derives it.

- `stack.json`            template decisions (framework, ORM, UI kit, deploy). Agents do not reopen these.
- `templates/store-example/`   Fernhollow's five spec files, the worked example for the store template:
  `vision.md`, `requirements.json`, `experience.json`, `domain-model.json`, `edges.json`.
- Capabilities (what the runtime can build) live in `src/lib/builder/brief.ts` (`CAPABILITIES`).
  General edge rules that reach onboarding live in `EDGE_RULES` in the same file.

Rules
- Nothing store-specific goes in here. An edge learned from one store is written in general terms, reviewed, then added.
- When `edges.json` gains a general edge, add a matching rule to `EDGE_RULES` so onboarding warns about it.
- Record the knowledge version on each app, so older apps can be re-checked when it changes.

Planned: vision and spec templates per type of app, drafted from `store-example`; the spec writer and spec checker read from here.
