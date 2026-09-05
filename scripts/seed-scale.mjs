#!/usr/bin/env node
/**
 * Build the reference-scale dataset of spec 29.1 (GAP-23): 100 projects, 10,000 live
 * tasks, 100,000 rows including completed and trashed history, a 500-card board, 20 tags
 * on a subset, and one heavily edited task with 1,000 activity events.
 *
 * Everything is written through the repositories and the domain policies, never through
 * hand-written SQL, so the shape stays correct as the schema evolves: a task is built by
 * `createTask` and completed by `completeTask`, a project comes from `ProjectService`.
 * The one exception is looking up an existing account by email, which lives in the auth
 * package's own table and has no repository. Two maintenance statements are also issued
 * directly and write no data: `truncate` (via the test harness, behind `--reset`) and
 * `analyze`, so the planner has current statistics before anything is measured.
 *
 * Deliberately not seeded, because the benchmark does not read them and they would
 * multiply the row count by ten: an activity and outbox row per task. Activity is seeded
 * only where spec 29.1 asks for it, on a few heavily edited tasks.
 *
 * Requires `pnpm build`.
 *
 *   node scripts/seed-scale.mjs --database-url postgresql://... --reset
 *   node scripts/seed-scale.mjs --email bench@example.com --scale small
 *
 * Options:
 *   --database-url URL  target database (default SEED_DATABASE_URL, then DATABASE_URL)
 *   --email ADDRESS     seed into this existing account's workspace; created if absent
 *   --reset             truncate every table first (refused against DATABASE_URL)
 *   --scale reference|small   full spec 29.1 scale, or a fast CI-sized fraction
 *   --seed N            PRNG seed, so two runs produce the same dataset (default 23)
 *   --json              print the summary as JSON on the last line
 */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const root = resolve(import.meta.dirname, "..");
// Workspace packages are dependencies of the web app, not of the repository root, so they
// are resolved from there (the same indirection scripts/worker.mjs uses).
const require = createRequire(resolve(root, "apps/web/package.json"));
const load = (name) => import(pathToFileURL(require.resolve(name)).href);

const [{ loadRootEnv }, application, database, domain] = await Promise.all([
  load("@morrowlist/config/load-env"),
  load("@morrowlist/application"),
  load("@morrowlist/database"),
  load("@morrowlist/domain"),
]);
loadRootEnv();

const { values } = parseArgs({
  options: {
    "database-url": { type: "string" },
    email: { type: "string" },
    reset: { type: "boolean", default: false },
    scale: { type: "string", default: "reference" },
    seed: { type: "string", default: "23" },
    json: { type: "boolean", default: false },
  },
});

/**
 * Reference scale is spec 29.1. `small` keeps every structural feature — a full board, a
 * heavily edited task, tasks carrying twenty tags — at a fraction of the row count, so
 * CI can prove the seed still runs without spending ten minutes on it.
 */
const SCALES = {
  reference: {
    projects: 100,
    liveTasks: 10_000,
    totalTasks: 100_000,
    boardCards: 500,
    inboxTasks: 1_200,
    tags: 40,
    heavilyTaggedTasks: 500,
    heavilyEditedTasks: 3,
    activityPerEditedTask: 1_000,
  },
  small: {
    projects: 10,
    liveTasks: 1_000,
    totalTasks: 5_000,
    boardCards: 200,
    inboxTasks: 200,
    tags: 20,
    heavilyTaggedTasks: 50,
    heavilyEditedTasks: 1,
    activityPerEditedTask: 1_000,
  },
};

const scale = SCALES[values.scale];
if (!scale) {
  console.error(`seed-scale: unknown --scale ${values.scale}; use reference or small`);
  process.exit(1);
}
if (scale.totalTasks < scale.liveTasks) {
  console.error("seed-scale: totalTasks must be at least liveTasks");
  process.exit(1);
}

const developmentUrl = process.env.DATABASE_URL;
const target =
  values["database-url"] ?? process.env.SEED_DATABASE_URL ?? developmentUrl;
if (!target) {
  console.error(
    "seed-scale: no target database. Set SEED_DATABASE_URL or pass --database-url.",
  );
  process.exit(1);
}
if (values.reset && target === developmentUrl) {
  console.error(
    "seed-scale: --reset refuses to truncate DATABASE_URL. Point it at a throwaway database.",
  );
  process.exit(1);
}

/**
 * mulberry32: small, fast, and seedable, so the dataset is reproducible. Nothing here is
 * security-sensitive — it decides which task gets a due date.
 */
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = makeRandom(Number(values.seed));
const pick = (list) => list[Math.floor(random() * list.length)];
const chance = (probability) => random() < probability;

// A vocabulary rather than random characters, so the full-text index has realistic term
// frequencies and the search benchmark measures something real.
const VERBS = [
  "Draft",
  "Review",
  "Ship",
  "Refactor",
  "Investigate",
  "Migrate",
  "Document",
  "Schedule",
  "Prepare",
  "Follow up on",
  "Archive",
  "Estimate",
  "Rewrite",
  "Audit",
  "Publish",
];
const NOUNS = [
  "onboarding flow",
  "billing report",
  "quarterly review",
  "database migration",
  "design tokens",
  "support backlog",
  "release notes",
  "incident postmortem",
  "customer interview",
  "roadmap draft",
  "search relevance",
  "accessibility pass",
  "pricing page",
  "vendor contract",
  "team retrospective",
];
const QUALIFIERS = [
  "for the mobile client",
  "before the next release",
  "with the platform team",
  "in the shared workspace",
  "ahead of the audit",
  "",
  "",
  "",
];
/** Rare on purpose: the search benchmark queries a term that matches ~1% of rows. */
const RARE_TERM = "kanban";

function title(index) {
  const rare = index % 100 === 0 ? ` ${RARE_TERM}` : "";
  return `${pick(VERBS)} the ${pick(NOUNS)}${rare} ${pick(QUALIFIERS)}`.trim();
}

function description(index) {
  if (!chance(0.4)) return null;
  return `Context for item ${index}. ${pick(VERBS)} the ${pick(NOUNS)}, then ${pick(NOUNS)}.`;
}

const TAG_WORDS = [
  "deep-work",
  "quick-win",
  "blocked",
  "waiting",
  "design",
  "backend",
  "frontend",
  "infra",
  "docs",
  "research",
  "customer",
  "billing",
  "security",
  "performance",
  "accessibility",
  "mobile",
  "api",
  "data",
  "hiring",
  "ops",
  "planning",
  "review",
  "urgent",
  "someday",
  "meeting",
  "follow-up",
  "bug",
  "chore",
  "spike",
  "launch",
  "q1",
  "q2",
  "q3",
  "q4",
  "team-a",
  "team-b",
  "team-c",
  "external",
  "internal",
  "personal",
];

const PRIORITIES = ["none", "low", "medium", "high", "urgent"];

/** `YYYY-MM-DD` in UTC, which is the workspace timezone this seed uses. */
function plainDate(date) {
  return date.toISOString().slice(0, 10);
}
function shiftDays(date, days) {
  return new Date(date.getTime() + days * 86_400_000);
}

const NOW = new Date();
const TODAY = plainDate(NOW);

const handle = database.createDatabase({
  connectionString: target,
  max: 2,
  applicationName: "morrowlist-seed-scale",
});
const unitOfWork = database.createUnitOfWork(handle);
const clock = { now: () => NOW };

const started = Date.now();
const step = (label) => {
  const at = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`seed-scale: [${at}s] ${label}`);
};

try {
  if (values.reset) {
    await database.truncateAll(handle);
    step("truncated every table");
  }

  // --- account and workspace ------------------------------------------------
  // An account created over the sign-up API already owns a workspace; reuse it so the
  // benchmark can sign in as a real user. Otherwise bootstrap one that has no login.
  const email = values.email ?? "scale-seed@example.com";
  const { rows } = await handle.pool.query(
    'select id from "auth_user" where email = $1',
    [email],
  );
  const userId = rows[0]?.id ?? domain.uuidv7();
  const { workspace } = await application.bootstrapUser(
    { unitOfWork, clock },
    {
      userId,
      email,
      displayName: "Scale Seed",
      timezone: "UTC",
      taskKeyPrefix: "ML",
    },
  );
  const context = {
    actorKind: "user",
    actorId: userId,
    userId,
    actorDisplayName: "Scale Seed",
    workspaceIds: [workspace.id],
    scopes: new Set(),
    requestId: "seed-scale",
  };
  const policyContext = { actor: { kind: "user", id: userId }, clock };
  step(`workspace ${workspace.slug} (${workspace.id}) for ${email}`);

  // --- tags -----------------------------------------------------------------
  const tagService = new application.TagService({ unitOfWork, clock });
  const tags = [];
  for (const name of TAG_WORDS.slice(0, scale.tags)) {
    tags.push(await tagService.create(context, workspace.id, { name }));
  }
  step(`${tags.length} tags`);

  // --- projects -------------------------------------------------------------
  const projectService = new application.ProjectService({ unitOfWork, clock });
  const projects = [];
  for (let i = 0; i < scale.projects; i += 1) {
    const detail = await projectService.create(context, {
      workspaceId: workspace.id,
      name: `${pick(NOUNS).replace(/^./, (c) => c.toUpperCase())} ${i + 1}`,
    });
    projects.push({ id: detail.project.id });
  }
  // The service returns transport DTOs; the domain policies below need the entity, so the
  // workflow is read back through the repository rather than reshaped by hand.
  await unitOfWork.execute(async (tx) => {
    for (const project of projects) {
      const statuses = await tx.statuses.listByProject(project.id);
      // Only a nonterminal status can hold a new task (spec 8.5); the terminal one is
      // where completion moves it.
      project.active = statuses.filter((status) => !domain.isTerminal(status));
      project.done = statuses.find((status) => domain.isTerminal(status));
    }
  });
  step(`${projects.length} projects with their default workflows`);

  // --- tasks ----------------------------------------------------------------
  // Ranks are generated per ordering scope in one pass. `rankBetween` walked 100,000
  // times from a single cursor produces ever-longer keys; `ranksBetween` spreads a whole
  // scope evenly instead, which is what a real column of that size looks like.
  const rankPool = new Map();
  const nextRank = (scopeKey, expected) => {
    let pool = rankPool.get(scopeKey);
    if (!pool) {
      pool = { keys: domain.ranksBetween(null, null, expected), index: 0 };
      rankPool.set(scopeKey, pool);
    }
    if (pool.index >= pool.keys.length) {
      // The estimate was low; extend from the last key rather than restart.
      const last = pool.keys[pool.keys.length - 1];
      pool.keys = pool.keys.concat(domain.ranksBetween(last, null, expected));
    }
    const key = pool.keys[pool.index];
    pool.index += 1;
    return key;
  };

  const BATCH = 1_000;
  const boardProject = projects[0];
  const counts = {
    live: 0,
    completed: 0,
    deleted: 0,
    inbox: 0,
    /** Live cards in the board project — more than the 500 one board query returns. */
    boardLive: 0,
    subtasks: 0,
    dueToday: 0,
    overdue: 0,
    deferred: 0,
  };
  /** Live, top-level, project tasks, kept for tagging, relations and day plans. */
  const liveProjectTasks = [];
  const liveInboxTasks = [];
  /** Candidate parents, so subtasks attach to a task that already exists. */
  const parents = [];

  const historyTasks = scale.totalTasks - scale.liveTasks;
  const deletedTasks = Math.round(historyTasks * 0.06);
  const completedTasks = historyTasks - deletedTasks;

  /**
   * One task, decided from its index so the mix is deterministic.
   *
   * The first `boardCards` project tasks all land in the board project and stay
   * top-level, undeferred and open, so its board query returns a full 500 cards.
   */
  function planTask(index, kind) {
    const onBoard = kind === "live" && index < scale.boardCards;
    const inbox =
      !onBoard && kind === "live" && index < scale.boardCards + scale.inboxTasks;
    const project = onBoard ? boardProject : inbox ? null : pick(projects);
    const status = project ? pick(project.active) : null;

    // Dates: a realistic tail of overdue work, a busy today, and a month of upcoming.
    let dueDate = null;
    let deferUntil = null;
    let deadline = null;
    if (kind === "live") {
      if (chance(0.012))
        dueDate = plainDate(shiftDays(NOW, -1 - Math.floor(random() * 20)));
      else if (chance(0.01)) dueDate = TODAY;
      else if (chance(0.25))
        dueDate = plainDate(shiftDays(NOW, 1 + Math.floor(random() * 45)));
      if (!onBoard && chance(0.04))
        deferUntil = plainDate(shiftDays(NOW, 2 + Math.floor(random() * 20)));
      if (chance(0.06))
        deadline = plainDate(shiftDays(NOW, Math.floor(random() * 40) - 5));
    } else if (chance(0.5)) {
      dueDate = plainDate(shiftDays(NOW, -30 - Math.floor(random() * 300)));
    }

    const parent =
      kind === "live" && !onBoard && !inbox && parents.length > 0 && chance(0.12)
        ? pick(parents)
        : null;

    return { project, status, dueDate, deferUntil, deadline, parent, inbox, onBoard };
  }

  async function insertBatch(tx, kind, from, to) {
    for (let index = from; index < to; index += 1) {
      const plan = planTask(index, kind);
      const scopeKey = plan.project
        ? `${plan.project.id}:${plan.status.id}`
        : `${workspace.id}:inbox`;
      const createdAt = shiftDays(NOW, -Math.floor(random() * 400));
      const taskNumber = await tx.taskCounters.allocate(workspace.id);
      const createContext = {
        actor: policyContext.actor,
        clock: { now: () => createdAt },
      };

      let task = domain.createTask(
        {
          id: domain.uuidv7At(createdAt.getTime()),
          workspaceId: workspace.id,
          taskNumber,
          title: title(index),
          descriptionMd: description(index),
          rank: nextRank(scopeKey, 2_000),
          priority: pick(PRIORITIES),
          dueDate: plan.dueDate,
          deferUntil: plan.deferUntil,
          deadline: plan.deadline,
          parentTaskId: plan.parent,
          project: plan.project ? { id: plan.project.id, status: plan.status } : null,
        },
        createContext,
      );

      if (kind === "completed") {
        const doneStatus = plan.project
          ? {
              status: plan.project.done,
              rank: nextRank(`${plan.project.id}:${plan.project.done.id}`, 2_000),
            }
          : undefined;
        task = domain.completeTask(task, { doneStatus }, policyContext);
        counts.completed += 1;
      } else if (kind === "deleted") {
        task = domain.deleteTask(task, policyContext);
        counts.deleted += 1;
      } else {
        counts.live += 1;
        if (plan.inbox) {
          counts.inbox += 1;
          liveInboxTasks.push(task.id);
        } else {
          liveProjectTasks.push(task.id);
          if (plan.project.id === boardProject.id) counts.boardLive += 1;
          if (parents.length < 400 && !plan.parent) parents.push(task.id);
        }
        if (plan.parent) counts.subtasks += 1;
        if (plan.dueDate === TODAY) counts.dueToday += 1;
        else if (plan.dueDate !== null && plan.dueDate < TODAY) counts.overdue += 1;
        if (plan.deferUntil !== null) counts.deferred += 1;
      }

      await tx.tasks.insert(task);
    }
  }

  for (const [kind, total] of [
    ["live", scale.liveTasks],
    ["completed", completedTasks],
    ["deleted", deletedTasks],
  ]) {
    for (let from = 0; from < total; from += BATCH) {
      const to = Math.min(from + BATCH, total);
      await unitOfWork.execute((tx) => insertBatch(tx, kind, from, to));
      if (to % 10_000 === 0 || to === total) step(`${kind}: ${to}/${total} tasks`);
    }
  }

  // --- tags on tasks --------------------------------------------------------
  // Spec 29.1 asks for a task carrying twenty tags; the long tail carries one or two,
  // which is what makes the tag filter's selectivity realistic.
  //
  // The twenty-tag tasks are the board project's cards, which is deliberate: it puts the
  // reference scale's two heaviest requirements — 500 cards in one board query and 20
  // tags per task — on the same response, so the board benchmark measures the worst page
  // the spec asks the product to serve rather than a comfortable one.
  await unitOfWork.execute(async (tx) => {
    for (let i = 0; i < scale.heavilyTaggedTasks; i += 1) {
      const taskId = liveProjectTasks[i];
      if (!taskId) break;
      for (const tag of tags.slice(0, 20)) {
        await tx.tasks.addTag(taskId, tag.id, NOW);
      }
    }
  });
  const tailTagged = liveProjectTasks.length;
  for (let from = scale.heavilyTaggedTasks; from < tailTagged; from += BATCH) {
    const to = Math.min(from + BATCH, tailTagged);
    await unitOfWork.execute(async (tx) => {
      for (let i = from; i < to; i += 1) {
        if (!chance(0.35)) continue;
        const taskId = liveProjectTasks[i];
        const chosen = new Set([pick(tags).id]);
        if (chance(0.4)) chosen.add(pick(tags).id);
        for (const tagId of chosen) await tx.tasks.addTag(taskId, tagId, NOW);
      }
    });
  }
  step("tag associations");

  // --- relations, day plans, activity --------------------------------------
  await unitOfWork.execute(async (tx) => {
    const edges = Math.min(500, Math.floor(liveProjectTasks.length / 4));
    for (let i = 0; i < edges; i += 1) {
      const a = liveProjectTasks[i * 2];
      const b = liveProjectTasks[i * 2 + 1];
      if (!a || !b) break;
      // `blocks` is directed; `related_to` is symmetric and stored once in canonical id
      // order, so the unique index sees A–B and B–A as the same edge (spec 8.2).
      const symmetric = i % 2 === 1;
      const [source, targetTask] = symmetric && a > b ? [b, a] : [a, b];
      await tx.tasks.insertRelation({
        id: domain.uuidv7(),
        workspaceId: workspace.id,
        sourceTaskId: source,
        targetTaskId: targetTask,
        type: symmetric ? "related_to" : "blocks",
        metadata: {},
        createdBy: policyContext.actor,
        createdAt: NOW,
      });
    }
  });
  step("task relations");

  await unitOfWork.execute(async (tx) => {
    for (const taskId of liveInboxTasks.slice(0, 60)) {
      await tx.dayPlans.insert({
        taskId,
        planDate: TODAY,
        source: "manual",
        createdBy: policyContext.actor,
        createdAt: NOW,
      });
    }
  });
  step("My Day selections for today");

  // Spec 29.1: 1,000 activity events on a heavily edited task, paginated.
  const heavilyEdited = liveProjectTasks.slice(0, scale.heavilyEditedTasks);
  for (const taskId of heavilyEdited) {
    for (let from = 0; from < scale.activityPerEditedTask; from += BATCH) {
      const to = Math.min(from + BATCH, scale.activityPerEditedTask);
      await unitOfWork.execute(async (tx) => {
        for (let i = from; i < to; i += 1) {
          const at = shiftDays(NOW, -Math.floor(i / 4));
          await tx.activity.append({
            id: domain.uuidv7At(at.getTime()),
            workspaceId: workspace.id,
            aggregateType: "task",
            aggregateId: taskId,
            eventType: "task.updated",
            actorKind: "user",
            actorId: userId,
            actorDisplayName: "Scale Seed",
            summary: `Edited the task (revision ${i + 1})`,
            payload: { revision: i + 1 },
            correlationId: `seed-${i}`,
            createdAt: at,
          });
        }
      });
    }
  }
  step(`${heavilyEdited.length} heavily edited tasks with activity history`);

  // The planner needs current statistics before anything is measured against this data.
  await handle.pool.query("analyze");
  step("analyze");

  const summary = {
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    email,
    boardProjectId: boardProject.id,
    tagId: tags[0]?.id ?? null,
    /** The task carrying 1,000 activity events, for the paginated-activity read. */
    activityTaskId: heavilyEdited[0] ?? null,
    searchTerm: RARE_TERM,
    projects: projects.length,
    tags: tags.length,
    ...counts,
    total: counts.live + counts.completed + counts.deleted,
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
  };
  console.log(
    `seed-scale: done in ${summary.seconds}s — ${summary.total} tasks ` +
      `(${summary.live} live, ${summary.completed} completed, ${summary.deleted} trashed), ` +
      `${summary.projects} projects, board project ${summary.boardProjectId}`,
  );
  if (values.json) console.log(JSON.stringify(summary));
} finally {
  await handle.close();
}
