# Appnomics Builder: instructions for Claude Code

Read `ARCHITECTURE.md` (the map) and `AGENTS.md` (this Next.js version has breaking changes; check `node_modules/next/dist/docs` before using an API from memory) before changing anything.

## Commands
- `npm run typecheck` and `npm test` must pass before you say a change is done.
- `npm run dev`, `npm run worker`, `npm run db:generate`, `npm run db:migrate`, `npm run sync:site-pack`.
- Tests are plain scripts in `test/`, one file each, run by `scripts/run-tests.mjs`. New logic gets a test in the same style. Tests must not need a database or keys; the worker tests use an in-memory fake.

## Where things are
- Pages and API routes: `src/app`. Interview and change logic: `src/lib/agents`. Brief, plan, readers: `src/lib/builder`.
- Slow work is a job: the route inserts a row in `jobs`, `worker/index.ts` runs it. Job types: `site_build`, `site_publish`, `site_change`, `site_admin`.
- Pack truth (specs, interview questions, example brief) lives in `../appnomics-runner/vertical-packs`. Never edit `src/lib/builder/site-pack.generated.ts` by hand; edit the runner and run `npm run sync:site-pack`.
- Changes under `worker/` or in the runner need `fly deploy` to take effect; a push does not.

## Rules from the owner (RP)
- Commit messages: plain words, no quotes, no apostrophes, no escapes.
- Never print, ask for or write keys, passwords or hashes in chat, logs or files. Names of variables only.
- Nothing invented in a customer's site: no made-up prices, hours, address, phone, story or reviews. If the owner did not give it, the site shows a placeholder or leaves it out, and the check list says so.
- Words shown to owners are plain, short and kind. They are not technical people.
- Code chooses and validates; the model only words things. Keep interviews that way.
- Keep it simple. Ask before adding a feature to the restaurant pack or a new pack; ideas go in `../appnomics-runner/PARKING_LOT.md`.
- Do not commit real restaurants' briefs (`briefs/marina-india-cuisine-*`) or any `.env`.
- A migration is committed with the code that needs it, and applied to production first.
