/** Synthetic, repeatable content for the isolated frontend redesign preview. */
const origin = process.argv[2] ?? "http://127.0.0.1:3242";
if (origin !== "http://127.0.0.1:3242") {
  throw new Error("This seed only supports the isolated preview at 127.0.0.1:3242.");
}

const credentials = {
  email: "studio@example.test",
  password: "MorrowStudio2026!",
};
let token;

async function request(path, method = "GET", body) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(result)}`);
  }
  return result;
}

let auth;
try {
  auth = await request("/api/auth/sign-in/email", "POST", credentials);
} catch {
  auth = await request("/api/auth/sign-up/email", "POST", {
    ...credentials,
    name: "Morrow Studio",
  });
}
token = auth.token;
if (!token) throw new Error("The preview sign-in did not return a session.");

const existing = await request("/api/v1/projects");
if (existing.data.length > 0) {
  console.log(
    "Preview account already has projects; skipping to preserve its content.",
  );
  process.exit(0);
}

const { data: today } = await request("/api/v1/views/today");
const shiftDate = (days) => {
  const date = new Date(`${today.date}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const projects = {};
for (const project of [
  {
    name: "Product launch",
    colorToken: "teal",
    descriptionMd:
      "Make something worth sharing. A thoughtful first chapter for our new product.",
  },
  {
    name: "Everyday",
    colorToken: "amber",
    descriptionMd: "A little space for life outside the work.",
  },
  {
    name: "Learning",
    colorToken: "violet",
    descriptionMd: "Follow curiosity, one small discovery at a time.",
  },
]) {
  const { data } = await request("/api/v1/projects", "POST", project);
  projects[project.name] = data;
}

const seeds = [
  {
    title: "Shape the launch story",
    project: "Product launch",
    category: "in_progress",
    priority: "high",
    selected: true,
    descriptionMd:
      "Find the one sentence that makes the value feel obvious. Then build the opening around it.",
  },
  {
    title: "Sketch the welcome flow",
    project: "Product launch",
    category: "todo",
    selected: true,
    descriptionMd:
      "A calm first minute: one useful action, a little encouragement, and room to explore.",
  },
  {
    title: "Send the beta invitations",
    project: "Product launch",
    category: "todo",
    dueDate: today.date,
    descriptionMd:
      "Invite the first five people. Keep the note personal and ask what they hope this will help with.",
  },
  {
    title: "Polish the product walkthrough",
    project: "Product launch",
    category: "backlog",
    dueDate: shiftDate(2),
  },
  {
    title: "Review the first week of feedback",
    project: "Product launch",
    category: "backlog",
    dueDate: shiftDate(4),
  },
  {
    title: "Collect customer interview notes",
    project: "Product launch",
    category: "todo",
    complete: true,
  },
  {
    title: "Take a proper lunch break",
    project: "Everyday",
    category: "todo",
    selected: true,
    descriptionMd:
      "Step away from the screen. Make something good. The work can wait a little.",
  },
  {
    title: "Plan a weekend by the water",
    project: "Everyday",
    category: "backlog",
    dueDate: shiftDate(5),
  },
  {
    title: "Read one chapter of Creative Act",
    project: "Learning",
    category: "in_progress",
    selected: true,
  },
  {
    title: "Try a small generative art study",
    project: "Learning",
    category: "backlog",
  },
  {
    title: "A tiny idea for a better morning routine",
    descriptionMd: "Leave this here for now. It does not need a plan yet.",
  },
  { title: "Save that typography reference" },
  { title: "Look into the neighborhood pottery class" },
];

for (const { project, category, selected, complete, ...body } of seeds) {
  const destination = project ? projects[project] : undefined;
  const status =
    destination?.statuses.find((entry) => entry.category === category) ??
    destination?.statuses.find((entry) => entry.isDefault);
  const { data: task } = await request("/api/v1/tasks", "POST", {
    ...body,
    ...(destination ? { projectId: destination.project.id, statusId: status.id } : {}),
    ...(selected ? { addToDay: today.date } : {}),
  });
  if (complete) await request(`/api/v1/tasks/${task.id}/complete`, "POST", {});
}

console.log(`Seeded 3 projects and ${seeds.length} synthetic tasks for ${today.date}.`);
console.log("Preview: http://127.0.0.1:3242/today");
console.log("Demo account: studio@example.test / MorrowStudio2026!");
