/**
 * Publishing integrations. Every call goes through these interfaces so the worker and the
 * tests never need real accounts. INTEGRATIONS=stub records what would happen. INTEGRATIONS=live
 * calls GitHub, Vercel and Neon with the tokens in .env (tokens stay server side, never in an agent's context).
 */

export type StepResult = { step: string; detail: string };

export interface PublishIntegrations {
  createRepoFromTemplate(name: string): Promise<StepResult>;
  createDatabase(name: string): Promise<StepResult>;
  createVercelProject(name: string, repo: string): Promise<StepResult>;
  setEnvVars(name: string, keys: string[]): Promise<StepResult>;
}

const stub: PublishIntegrations = {
  createRepoFromTemplate: async (name) => ({ step: "github", detail: `[stub] would create ${process.env.GITHUB_ORG || "<org>"}/${name} from ${process.env.GITHUB_TEMPLATE_REPO || "<template>"}` }),
  createDatabase: async (name) => ({ step: "neon", detail: `[stub] would create a Neon database for ${name}` }),
  createVercelProject: async (name, repo) => ({ step: "vercel", detail: `[stub] would create Vercel project ${name} linked to ${repo}` }),
  setEnvVars: async (name, keys) => ({ step: "env", detail: `[stub] would set ${keys.join(", ")} on ${name}` }),
};

const notLive = (what: string) => async (): Promise<StepResult> => {
  throw new Error(`${what} is not implemented yet. Set INTEGRATIONS=stub, or implement it in src/lib/integrations.`);
};

const live: PublishIntegrations = {
  createRepoFromTemplate: notLive("GitHub repo creation"),
  createDatabase: notLive("Neon database creation"),
  createVercelProject: notLive("Vercel project creation"),
  setEnvVars: notLive("Vercel env vars"),
};

export function getIntegrations(): PublishIntegrations {
  return process.env.INTEGRATIONS === "live" ? live : stub;
}
