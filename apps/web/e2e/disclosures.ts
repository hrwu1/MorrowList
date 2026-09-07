import { expect, type Locator, type Page } from "@playwright/test";

/** Project routes open the studio; Kanban journeys explicitly choose their canvas. */
export async function openProjectBoard(page: Page, projectName?: string) {
  if (projectName) {
    await expect(
      page.getByRole("heading", { level: 1, name: projectName, exact: true }),
    ).toBeVisible();
  }
  const board = page
    .getByRole("navigation", { name: "Project views", exact: true })
    .getByRole("link", { name: "Board", exact: true });
  await expect(board).toBeVisible();
  if ((await board.getAttribute("aria-current")) !== "page") await board.click();
  await expect(board).toHaveAttribute("aria-current", "page");
}

/** Follow the same visible disclosure a keyboard or pointer user opens. */
export async function openSection(surface: Page | Locator, name: string) {
  const summary = surface.locator("summary").filter({ hasText: name });
  if (
    !(await summary.evaluate(
      (element) => (element.parentElement as HTMLDetailsElement).open,
    ))
  ) {
    await summary.click();
  }
}
