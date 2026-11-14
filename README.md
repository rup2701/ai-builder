# Appnomics Builder

The web app where a person describes a website, chats with Scout, approves a plan and gets a live site. Runs on Vercel at builder.appnomics.dev. The slow work happens in the worker (`worker/`) on Fly, which drives the runner (`../appnomics-runner`).

New here? Read `ARCHITECTURE.md` first (ten minutes), then this page.

## What works today
- Sign in with Google, invite-only (`ALLOWED_EMAILS` or an access code from `npm run code`).
- Three site kinds: waitlist website, website for an existing product, restaurant website (the last two behind switches).
- Scout: an interview that reads the person's existing website, asks only what is missing, shows a plan card, builds, and shows a ready card with a check list.
- After launch: change requests, preview, publish, undo (waitlist and showcase sites).
- Restaurant sites: table requests by email, and an owner area (menu spreadsheet, requests) added after the site is live.
- Docs for users under `/docs`.

## Set up
    npm install
    cp .env.example .env     # fill in; names and meanings are in the file
    npm run db:migrate
    npm run dev              # the web app on http://localhost:3000
    npm run worker           # in a second terminal: the worker (stub builds unless WORKER_SITE_MODE=real)

You need Node 22+. Real builds also need the runner next to this folder (`../appnomics-runner`, or set `RUNNER_DIR`), a local Postgres for the runner's run databases, and the keys listed in the runner README.

## Everyday commands
| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript check |
| `npm test` | Runs every test in `test/` (no database or keys needed) |
| `npm run dev` | Web app |
| `npm run worker` | Worker |
| `npm run db:generate` | New migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to the database in `.env` |
| `npm run sync:site-pack` | Copy interview and example brief from the runner packs into `src/lib/builder/site-pack.generated.ts` |
| `npm run code` | Make an access code |
| `npm run test:e2e` | Browser flow test (needs a running app and keys) |

Before saying a change is done: `npm run typecheck` and `npm test`.

## Layout
    src/app/          pages and API routes (App Router)
    src/lib/agents/   Scout interviewers, change planner
    src/lib/builder/  brief, plan card, website reader, menu import, state helpers
    src/db/           schema and migrations (drizzle/)
    worker/           job loop, site build, site change
    scripts/          sync-site-pack, run-tests, access codes
    test/             tests (plain scripts, one file each)
    e2e/              browser flow
    knowledge/        notes the agents read; see its README

## Releasing
- Web app: push to main. Vercel deploys.
- Worker or runner: `fly deploy` from `~/appnomics`. See `FLY.md` there.
- Schema change: generate, commit, run `db:migrate` against production before the code that needs it ships.

## Known gaps
- No retry button if the restaurant owner area fails twice.
- Changing a live restaurant site from Scout is not built; the menu is edited in the owner area.
- Builds run on one shared machine. Fine for trusted testers, not for strangers.
- No step that bills anyone. Spend is capped by `WORKER_BUILD_MAX_USD` and a workspace limit.
- Ideas not being built are in `../appnomics-runner/PARKING_LOT.md`.
