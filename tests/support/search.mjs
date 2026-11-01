import assert from "node:assert/strict";
import { open, stubPele } from "./browser.mjs";
import { hub, planData, waitUntil } from "./hub.mjs";

export const pages = [
  {
    id: "overview",
    title: "Overview",
    html: `
<h2>Failure handling</h2>
<p>Retries use exponential backoff.</p>`,
  },
  {
    id: "second",
    title: "Second page",
    html: "<p>A sentence about the walrus.</p><p>Another about the lemur.</p>",
  },
  {
    id: "many",
    title: "Many blocks",
    html: Array.from(
      { length: 12 },
      (_, number) => `<p>A llama numbered ${number}.</p>`,
    ).join(""),
  },
];

export async function searchPage(t, options = {}) {
  const h = await hub(t);
  const a = await h.session();
  const published = await a.publish({ ...planData(), pages });
  assert.equal(published.code, 200, published.body.error);
  const page = await open(t, "about:blank", options);
  if (!page) return {};
  await stubPele(page);
  await page.goto(`${h.server.origin}${a.base}/#overview`);
  await page.locator("#search-button").waitFor();
  await waitUntil(
    async () =>
      !(await (await fetch(`${h.server.origin}/api/search?q=x`)).json())
        .loading,
  );
  return { h, a, page };
}

export const type = async (page, query) => {
  const answered = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/search" &&
      new URL(response.url()).searchParams.get("q") === query,
  );
  await page.fill(".search-input", query);
  await answered;
  await page.evaluate(() => new Promise(requestAnimationFrame));
};
export const selected = (page) =>
  page.locator('.search-row[aria-selected="true"] .search-title');
export const selectedIndex = (page) =>
  page.locator('.search-row[aria-selected="true"]').getAttribute("data-i");

// Each menu stays open for more choices, so Esc closes it.
export async function chooseInMenu(page, menu, value) {
  await page.locator(`[data-menu="${menu}"] .search-menu-button`).click();
  await page.locator(`[data-menu="${menu}"] [data-value="${value}"]`).click();
  await page.keyboard.press("Escape");
}
export const everywhere = (page) => chooseInMenu(page, "sessions", "");
