# How Appnomics fits together

Read this first. It is the map; the READMEs hold the commands.

## The three pieces

```
 browser ──> Builder web app ──> database (Neon) <── worker (Fly) ──> runner (inside the worker)
             (Vercel)             "jobs" table        watches jobs     AI agent that builds the site
                                                                          │
                                                          deploys to ─────┴──> Vercel project + <name>.appnomics.live
                                                                               (waitlist sites also get a Neon database)
```

- **Builder web app** (`appnomics-builder/src`): what people click. Sign-in, the Scout chat, the plan card, projects, previews, the ready card. It saves a request as a job and returns at once. Runs on Vercel at builder.appnomics.dev.
- **Worker** (`appnomics-builder/worker`): runs on Fly as `appnomics-worker`. Watches the `jobs` table and does the slow work: build a site, change it, publish a change, undo it, add an owner area. Takes preview pictures, sends emails, writes results back to the project.
- **Runner** (`appnomics-runner`): the AI agent and the deploy script. It is code inside the worker's image (`/app/runner`), not a separate service. It builds each site in its own folder under `runs/` (`/data/runs` on Fly), runs typecheck and build itself, and deploys.

Vercel is the front desk; Fly is the workshop.

## Folders on disk

`~/appnomics/` holds `appnomics-builder/` and `appnomics-runner/` side by side, plus the Fly files (`Dockerfile`, `docker-entrypoint.sh`, `fly.toml`, `.dockerignore`, `FLY.md`). The Fly image is built from the files on disk there.

## A build, step by step

1. The person picks a template on `/new` and chats with Scout. Scout's interviewer (`src/lib/agents/*-interviewer.ts`) asks questions; code picks the next question and checks every answer, the model only words them.
2. The answers become a **brief** (`src/lib/builder/site-brief.ts`, validated). A **plan card** shows the sections. For a restaurant, empty sections show as placeholders (template mode).
3. The build route (`src/app/api/projects/[id]/build`) queues a `site_build` job.
4. The worker claims it and calls the runner: fresh folder, the pack's specs and reference components, the agent builds, then the runner runs typecheck and build by itself.
5. The worker deploys, takes preview pictures, builds the "Check these before you share it" list (`checklist()` in `worker/site-build.ts`) and posts the **ready card** and emails.
6. Restaurant sites only: a `site_admin` job follows. It runs `deploy --add-database` (see below).
7. After launch, changes go through `change-planner.ts` → plan → `site_change` job → preview → approve → `site_publish`, with undo.

Job types in `worker/index.ts`: `site_build`, `site_publish`, `site_change`, `site_admin` (and an old stub `build`).

## Packs

A pack is a kind of site. Its truth lives in the runner at `vertical-packs/<pack>/`: `specs/` (the contract the agent builds against), `brief.example.json`, an interview, and for restaurants `reference/` (components copied as written).

| Pack | Builds | Public site | Database and owner area | Switch in the web app |
|---|---|---|---|---|
| `site` | Waitlist site | Neon + Vercel | Owner area for sign-ups, from the first deploy | on |
| `product-showcase` | Website for an existing product | Static, Vercel only | None | `ENABLE_SHOWCASE_PACK=1` |
| `local-business` | Restaurant site (home, /menu, /story) | Static, Vercel only | Added after Live (stage two) | `ENABLE_LOCAL_PACK=1` and `ENABLE_LOCAL_BUILD=1` |
| `store` | Online store | Runner only; its deploy variable names are not mapped | Owner area | not in the current flow |

The Builder copies each pack's interview and example brief into `src/lib/builder/site-pack.generated.ts`. After changing either in the runner, run `npm run sync:site-pack` in the Builder and commit the generated file.

## Restaurant: two stages

- **Stage one (public site).** Static. No database, no API routes. The build agent is told so on purpose.
- **Stage two (owner area).** Plain code, no model: `appnomics-runner/src/add-admin.ts` copies `reference/admin/` into the finished app and switches its pages to read the menu from a database. `deploy --add-database` then creates a Neon project of its own for the site, creates tables, hashes the owner password, sets production settings, deploys and checks the sign-in page. The sign-in goes onto the ready card, once.
- A failure before the final deploy removes the new database and leaves the live site untouched. The worker retries once, then says so in the chat. There is no retry button yet.
- Sites built before 13 Nov 2026 have no owner area until rebuilt.

## Where things live

| Thing | Where |
|---|---|
| Web app pages and API routes | `appnomics-builder/src/app` |
| Scout interviewers and the change planner | `src/lib/agents` |
| Brief, plan card, website reader, imports, menu spreadsheet | `src/lib/builder` |
| Database schema and migrations | `src/db/schema.ts`, `drizzle/` |
| Worker | `worker/` (`index.ts`, `site-build.ts`, `site-change.ts`) |
| The agent, tools, checks, deploy | `appnomics-runner/src` |
| Pack specs, reference components, restaurant owner area | `appnomics-runner/vertical-packs` |
| Ideas not being built | `appnomics-runner/PARKING_LOT.md` |
| Status, decisions, timeline (notes) | the Appnomics vault |

## Accounts and where each secret lives

| Service | Used for | Secret lives in |
|---|---|---|
| GitHub | code | |
| Vercel | the web app; every customer site | Vercel env (web app); Fly secret `VERCEL_TOKEN` (worker) |
| Neon | the Builder's database; one database per waitlist or restaurant-with-owner-area site | Vercel env `DATABASE_URL`; Fly secrets `DATABASE_URL`, `NEON_API_KEY` |
| Fly | the worker | Fly secrets; `fly auth` on the machine you deploy from |
| Anthropic | the interviewer, planner and the build agent | Fly and Vercel secrets `ANTHROPIC_API_KEY`; set a spend limit on the workspace |
| Resend | build emails; restaurant table-request emails | `RESEND_API_KEY`, `EMAIL_FROM` on Vercel and Fly |
| Google Cloud | sign-in (OAuth client) | Vercel env `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` |
| Domains | appnomics.dev (site and builder), appnomics.live (customer sites) | DNS provider |

Vercel production settings cannot be read back once set, so the deploy state (including each site's Neon project id) is kept in `runs/<run>/deploy.json`. Keep that file; redeploys need it.

## How a change goes live

| You changed | How |
|---|---|
| The web app (`appnomics-builder/src`) | push; Vercel deploys |
| The worker (`appnomics-builder/worker`) or anything in the runner, including specs and reference components | `fly deploy` from `~/appnomics` |
| The database schema | `npm run db:generate`, commit, then `npm run db:migrate` against production |

A push alone never changes what runs on Fly. Deploy the worker only when no build or publish is in flight, because the restart stops a running job.

## Limits to know

- The worker and the agent's commands share one machine and one user, and the keys are in that process's environment. Fine for a few trusted testers; before strangers build, each build should run on its own machine with only its own keys.
- Failed builds can leave a Neon or Vercel project behind. Clean up in the dashboards.
- Each restaurant owner area costs one Neon project. Watch the Neon project limit.
- Changing a live restaurant site from the chat is not ready; its menu is changed in the owner area.
