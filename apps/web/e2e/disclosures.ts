import type { Locator, Page } from "@playwright/test";

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
