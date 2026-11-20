/**
 * Admins (RP): who sees the internal design stages (APP-43). ADMIN_EMAILS on Vercel, comma separated. Empty or unset means
 * nobody is an admin. Checked on the server; the browser only gets a yes or no.
 */
export function adminEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const isAdmin = (user: { email?: string | null } | null | undefined, env: NodeJS.ProcessEnv = process.env) =>
  !!user?.email && adminEmails(env).includes(user.email.trim().toLowerCase());
