import { readFile } from "node:fs/promises";

import { openProjectBoard, openSection } from "./disclosures";
import { expect, test, type Page } from "./fixtures";

/**
 * Export and import end to end (GAP-07, spec 30): download the archive and the task CSV,
 * then bring a Trello board in — dry run first, board afterwards.
 */

const PASSWORD = "correct-horse-battery-staple";

const TRELLO_BOARD = JSON.stringify({
  id: "b1",
  name: "Website Relaunch",
  closed: false,
  lists: [
    { id: "l1", name: "Backlog", closed: false, pos: 16384 },
    { id: "l2", name: "Doing", closed: false, pos: 32768 },
    { id: "l3", name: "Done", closed: false, pos: 49152 },
  ],
  labels: [{ id: "lb1", name: "research", color: "green" }],
  cards: [
    {
      id: "c1",
      name: "Interview five customers",
      desc: "Recruit from the waitlist.",
      closed: false,
      idList: "l1",
      idLabels: ["lb1"],
      due: "2026-09-14T12:00:00.000Z",
      dueComplete: false,
      pos: 16384,
    },
    {
      id: "c2",
      name: "Rewrite the pricing copy",
      desc: "",
      closed: false,
      idList: "l2",
      idLabels: [],
      due: null,
      dueComplete: false,
      pos: 16384,
    },
    {
      id: "c3",
      name: "Sign off the sitemap",
      desc: "",
      closed: false,
      idList: "l3",
      idLabels: [],
      due: null,
      dueComplete: false,
      pos: 16384,
    },
  ],
  checklists: [
    {
      id: "ch1",
      idCard: "c1",
      name: "Recruiting",
      pos: 16384,
      checkItems: [
        { id: "ci1", name: "Write the screener", state: "complete", pos: 16384 },
        { id: "ci2", name: "Send the invitations", state: "incomplete", pos: 32768 },
      ],
    },
  ],
});

async function signUp(page: Page) {
  const email = `data-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Data Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
}

async function captureInboxTask(page: Page, title: string) {
  const capture = page.getByPlaceholder("Add a task and press Enter");
  await capture.fill(title);
  await capture.press("Enter");
  await expect(page.getByRole("link", { name: title })).toBeVisible();
}

test("the archive and the task CSV download from Settings › Data", async ({ page }) => {
  await signUp(page);
  await captureInboxTask(page, "Draft the brief");

  await openSection(page, "Settings");
  await page.getByRole("link", { name: "Export and import" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Data" })).toBeVisible();

  const archiveDownload = page.waitForEvent("download");
  await page.getByTestId("export-archive").click();
  const archive = await archiveDownload;
  expect(archive.suggestedFilename()).toMatch(/^morrowlist-.+\.json$/);

  const parsed = JSON.parse(await readFile(await archive.path(), "utf8"));
  expect(parsed.format).toBe("morrowlist-export");
  expect(parsed.schemaVersion).toBe(1);
  expect(parsed.tasks.map((task: { title: string }) => task.title)).toEqual([
    "Draft the brief",
  ]);
  // Nothing that could authenticate anybody travels in the archive (spec 30.1).
  expect(JSON.stringify(parsed)).not.toContain("passwordHash");

  const csvDownload = page.waitForEvent("download");
  await page.getByTestId("export-csv").click();
  const csv = await csvDownload;
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);
  const csvBody = await readFile(await csv.path(), "utf8");
  expect(csvBody.split("\r\n")[0]).toContain("key,title,description,status");
  expect(csvBody).toContain("Draft the brief");
});

test("a Trello board previews, then imports as a board with columns, tags and subtasks", async ({
  page,
}) => {
  await signUp(page);
  await openSection(page, "Settings");
  await page.getByRole("link", { name: "Export and import" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Data" })).toBeVisible();

  await page.getByLabel("File").setInputFiles({
    name: "board.json",
    mimeType: "application/json",
    buffer: Buffer.from(TRELLO_BOARD),
  });

  // The dry run reports what would happen, and nothing is written yet.
  const preview = page.getByTestId("import-preview");
  await expect(preview).toBeVisible();
  await expect(
    preview.getByRole("heading", { name: /Website Relaunch/ }),
  ).toBeVisible();
  // Lists became columns with a guessed category, and labels became tags. The count is
  // cards, not subtasks, so it is the number the column will show.
  await expect(preview.getByText("backlog · 1 task")).toBeVisible();
  await expect(preview.getByText("in progress · 1 task")).toBeVisible();
  await expect(preview.getByText("Tags: research")).toBeVisible();
  await expect(
    preview.getByText("Backlog · due 2026-09-14 · #research · 2 subtasks"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Website Relaunch" }).first(),
  ).toHaveCount(0);

  await page.getByRole("button", { name: /^Import \d+ tasks into/ }).click();

  await expect(page.getByText("Imported Website Relaunch")).toBeVisible();
  await page.getByRole("link", { name: "Open the new board" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: "Website Relaunch" }),
  ).toBeVisible();
  await openProjectBoard(page);
  // Lists became columns, in board order.
  await expect(page.getByRole("region", { name: "Backlog" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Doing" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Done" })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Backlog" })
      .getByRole("link", { name: "Interview five customers" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Doing" })
      .getByRole("link", { name: "Rewrite the pricing copy" }),
  ).toBeVisible();

  // A card's checklist stays in the card's column rather than scattering.
  await page.goto(`${new URL(page.url()).pathname}?canvas=board&subtasks=show`);
  await expect(
    page
      .getByRole("region", { name: "Backlog" })
      .getByRole("link", { name: "Send the invitations" }),
  ).toBeVisible();

  // Labels became tags and checklist items became subtasks.
  await page.getByRole("link", { name: "Interview five customers" }).click();
  const panel = page.getByRole("complementary", { name: /Task details for/ });
  await expect(
    panel.getByRole("list", { name: "Tags" }).getByText("research", { exact: true }),
  ).toBeVisible();
  const subtasks = panel.getByRole("list", { name: "Subtasks" });
  await expect(subtasks.getByText("Write the screener")).toBeVisible();
  await expect(subtasks.getByText("Send the invitations")).toBeVisible();
});
