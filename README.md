# Appnomics Builder

The standalone builder app (builder.appnomics.dev). Describe what you want to launch; an intake chat asks a few
questions, shows what it will and will not build, then a worker builds it. This version runs the rule-based
interviewer and a stub builder, with real sign-in, saved projects, jobs, usage logging and tests. The model, the
builder agent and live publishing plug into the interfaces listed below.

Stack: Next.js 16 · React 19 · TypeScript · Tailwind 4 · shadcn/ui (copied in) · Drizzle · Postgres · Auth.js · Zod.
Decisions are in `knowledge/stack.json`.

## Run it

```bash
cp .env.example .env        # fill in the values below
npm install
npm run db:migrate
npm run dev                 # web app on :3000
npm run worker              # in a second terminal: runs build jobs
npm run test:e2e            # needs the app on :3100 and the worker; see e2e/flow.mjs
```

Local sign-in without Google: set `ALLOW_DEV_LOGIN=1` (ignored in production) and put your email in `ALLOWED_EMAILS`.

## Environment variables

| Variable | Needed for | Where it comes from |
| --- | --- | --- |
| `DATABASE_URL` | everything | Neon connection string (or local Postgres) |
| `AUTH_SECRET` | sign-in | `openssl rand -base64 32` |
| `AUTH_URL` | sign-in | the app's URL, e.g. `https://builder.appnomics.dev` |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google sign-in | Google Cloud console, OAuth client; redirect URI `<AUTH_URL>/api/auth/callback/google` |
| `ALLOWED_EMAILS` | access control | comma-separated; adding someone here is how you share the builder |
| `ALLOW_DEV_LOGIN` | local only | `1` on your machine, unset in production |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | the model interviewer | Anthropic console (setting the key turns the model interviewer on; without it the rule interviewer runs) |
| `INTEGRATIONS` | publishing | `stub` (default) or `live` |
| `GITHUB_ORG`, `GITHUB_TOKEN`, `GITHUB_TEMPLATE_REPO` | publishing | org for stores; GitHub App or fine-grained token (create repos, write contents and PRs); the template repo |
| `VERCEL_TOKEN`, `VERCEL_TEAM_ID` | publishing | token scoped to one team; the Vercel GitHub integration installed on the org |
| `NEON_API_KEY` | per-app databases | Neon console |
| `WORKER_STEP_MS` | tests | pause per build step in the stub builder (default 700) |

Tokens stay server side and never go into an agent's context.

## How it fits together

- `src/lib/builder/` the brief (questions, capability list, edge rules, summary), store settings, verify checks. Same code as the prototype.
- `src/lib/workspace/` workspace state and its transitions (pure functions). The server runs intake turns; the worker finishes builds; the browser runs the iterate phase and saves it.
- `src/lib/agents/interviewer.ts` the interface a model replaces. Keep the signature and the validator.
- `src/lib/integrations/` GitHub, Vercel, Neon interfaces with stubs. `live` throws until implemented.
- `worker/index.ts` claims queued jobs and runs them. A build survives closing the tab.
- `src/db/schema.ts` users, projects (state as JSON), jobs, usage, interventions, publish requests.
- `knowledge/` the knowledge pack.

## Not built yet

- Spec writer and spec checker. (The model interviewer exists: set `ANTHROPIC_API_KEY` to turn it on; `npm run test:interviewer` checks it against a fake model.)
- The builder agent (specs to repo to tests) in the worker; today it is a stub that draws the preview.
- Live GitHub, Vercel and Neon calls; the real preview deployment.
- Completion email (a build shows as ready in Your projects).
- Recording interventions from the UI (the table exists).

## How builds run

The web app and the worker are two separate programs that share one Postgres database.

- **Web app** (Next.js, on Vercel). Handles the chat, the interview and the pages. Each request lasts seconds, so it cannot run a 30-minute build.
- **Worker** (`npm run worker`). A long-running process that checks the `jobs` table every second, claims a queued job, does the slow work and writes progress back to the project's record.

Pressing **Build my site** works like this:

1. `POST /api/projects/:id/build` inserts a `site_build` job and sets the project to the build phase.
2. The worker claims the job and moves it through six stages: Getting ready, Building the pages, Polishing the look, Testing, Putting it online, Ready.
3. At each stage the worker writes `state.site.build` (stage, start time, files written, and later the live address). The right-hand pane polls the project and draws the timeline.
4. Closing the browser does not affect the build. The job is a row in the database.

The stage names live in `src/lib/builder/site-stages.ts`. The worker maps the runner's own stage markers (`1/4` to `4/4`, `3b/4`, and deploy's `1/7` to `7/7`) to those six stages.

**Status:** the worker currently runs a practice build that steps through the stages and builds nothing. The real build, where the worker runs the runner's `create` and `deploy`, is the next piece.

**Where the worker runs.** It cannot run on Vercel, because it is a long-lived process. Locally it runs next to `npm run dev`. If the local app and the deployed app share a database, a worker on your machine will also claim jobs queued from the deployed app, so only run one worker at a time. The plan for hosting is the web app on Vercel and the worker together with the runner on Fly (Node, git, Chromium and a Postgres for the per-build databases), moving to a separate Fly Machine per build.

Settings: `WORKER_FAKE_STAGE_MS` sets how long each stage of the practice build lasts (default 4000).