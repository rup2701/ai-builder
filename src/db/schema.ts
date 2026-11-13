import { sql } from "drizzle-orm";
import { boolean, customType, integer, jsonb, numeric, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** Access codes for the beta. The code itself is never stored, only its hash and the last four characters. */
export const accessCodes = pgTable("access_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  codeHash: text("code_hash").notNull().unique(),
  hint: text("hint").notNull(),
  label: text("label").notNull(),
  maxUses: integer("max_uses").notNull().default(1),
  uses: integer("uses").notNull().default(0),
  /** Site builds each person who joined with this code may start. Null means the global SITE_BUILD_LIMIT applies. */
  buildLimit: integer("build_limit"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  /** The code this person joined with. Null for people on ALLOWED_EMAILS. */
  accessCodeId: uuid("access_code_id").references(() => accessCodes.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New project"),
    /** "store" for now. The builder is general; each kind has its own templates. */
    kind: text("kind").notNull().default("store"),
    /** Sample apps are ours, used for experiments and demos. They can be reset. */
    isSample: boolean("is_sample").notNull().default(false),
    idea: text("idea").notNull().default(""),
    status: text("status").notNull().default("draft"), // draft | building | ready | published
    /** The whole workspace: messages, brief, versions. See src/lib/workspace/types.ts. */
    state: jsonb("state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("projects_owner_idx").on(t.ownerId)],
);

/** Long-running work. The web app queues it; the worker runs it. Survives closing the tab. */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // build | publish
    status: text("status").notNull().default("queued"), // queued | running | done | failed
    log: jsonb("log").notNull().default(sql`'[]'::jsonb`),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("jobs_status_idx").on(t.status, t.createdAt)],
);

/** Pictures an owner attached in the chat, converted to WebP. Kept until the worker copies them into the site's public/art folder. */
export const siteAssets = pgTable(
  "site_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mime: text("mime").notNull().default("image/webp"),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    size: integer("size").notNull(),
    bytes: bytea("bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("site_assets_project_idx").on(t.projectId)],
);

/** Tokens and cost per step, so every app has a real cost. */
export const usage = pgTable("usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
  step: text("step").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Each time a person has to step in. The experiment plan's core measure. */
export const interventions = pgTable("interventions", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
  kind: text("kind").notNull(), // fix | decision | debug
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Publishing is not open yet: people leave an email and role. */
export const publishRequests = pgTable("publish_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Table requests from a restaurant site's booking form. A request is not a booking: the owner confirms by phone or email.
 * The site posts to /api/reserve/<project id>; the owner is emailed, and the rows stay here for the admin screen later.
 */
export const tableRequests = pgTable(
  "table_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    guestName: text("guest_name").notNull(),
    phone: text("phone"),
    email: text("email"),
    /** The day and time the guest asked for, as they typed them (yyyy-mm-dd and hh:mm, in the restaurant's own time). */
    day: text("day").notNull(),
    time: text("time").notNull(),
    partySize: integer("party_size").notNull(),
    note: text("note"),
    /** new | confirmed | declined. Only "new" is used until the owner screen exists. */
    status: text("status").notNull().default("new"),
    /** Whether the owner's email went out. A failed email never loses the request. */
    emailed: boolean("emailed").notNull().default(false),
    /** A one-way hash of the visitor's address, only to limit how many requests one person can send. */
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("table_requests_project_idx").on(t.projectId, t.createdAt)],
);
