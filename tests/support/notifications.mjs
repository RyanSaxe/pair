import assert from "node:assert/strict";
import crypto from "node:crypto";
import { open, stubPele } from "./browser.mjs";
import { planData } from "./hub.mjs";

export const poll = { timeout: 8000 };
export const round = (title) => ({
  ...planData(),
  title,
  pages: [
    {
      id: "overview",
      title: "Overview",
      html: `<p id="result">Preserve one result per input.</p>${"<p>Filler paragraph.</p>".repeat(40)}`,
    },
    { id: "second", title: "Second", html: "<p>The second page.</p>" },
  ],
});
// The frame counts everything as already seen when no browser has a list yet, so
// the hub starts with an empty one.
export async function sessions(t, h) {
  const here = await h.session();
  const other = await h.session();
  assert.equal((await here.publish(round("Here"))).code, 200);
  assert.equal((await other.publish(round("Elsewhere"))).code, 200);
  await here.request("/api/seen", { cleared: [] });
  return { here, other };
}
export async function thread(
  session,
  text = "Where does this land?",
  extra = {},
) {
  const id = crypto.randomUUID();
  const started = await session.request(`${session.base}/api/threads`, {
    id,
    round: "1",
    topic: "overview",
    anchor: "Result line",
    target: "result",
    text,
    ...extra,
  });
  assert.equal(started.code, 201, JSON.stringify(started.body));
  return id;
}
export const reply = async (session, note, text) =>
  assert.equal((await session.action("reply", { note, text })).code, 200);
export async function replied(session, text, extra) {
  const id = await thread(session, "Where does this land?", extra);
  await reply(session, id, text);
  return id;
}
export async function propose(session, id, title) {
  const added = await session.action("propose", {
    id,
    title,
    delivers: `${title}, delivered.`,
    recommend: "here",
  });
  assert.equal(added.code, 200, added.body.error);
}
export async function openOn(t, h, session, options = {}, focused = true) {
  const page = await open(t, "about:blank", options);
  if (!page) return null;
  await stubPele(page);
  if (!focused)
    await page.addInitScript(() => {
      document.hasFocus = () => false;
    });
  await page.goto(`${h.server.origin}${session.base}/#second`);
  await page.locator("#bell").waitFor();
  return page;
}

export async function counts(page) {
  return page.evaluate(() => {
    const badge = document.getElementById("bell-count");
    return {
      bell: badge.hidden ? 0 : Number(badge.textContent),
      window:
        parseInt(document.querySelector(".search-count").textContent) || 0,
      title: Number(/^\((\d+)\)/.exec(document.title)?.[1] ?? 0),
    };
  });
}
// The bell's number, the tab's title and the window's count are the same number.
export async function agree(page, expected) {
  const { bell, window, title } = await counts(page);
  assert.equal(window, bell, "the window's count and the bell");
  assert.equal(title, bell, "the tab's title and the bell");
  if (expected !== undefined) assert.equal(bell, expected);
}
export const badge = (page, number) =>
  page.locator("#bell-count", { hasText: new RegExp(`^${number}$`) }).waitFor({
    ...poll,
    state: number ? "visible" : "hidden",
  });
export const row = (page, words) => page.locator(".nt-row", { hasText: words });
export const selected = (page) => page.locator('.nt-row[aria-selected="true"]');
export const heads = (page) =>
  page.locator(".search-group > span").allTextContents();
export const shownFrame = (page) => page.frameLocator(".search-frame.is-shown");
// The window asks the hub for its rows the first time it opens in a tab. Its
// first row is read 3 seconds after its page draws, so openAll returns as soon as
// the rows are in.
export async function openAll(page) {
  const asked = page
    .waitForRequest(/\/api\/notifications$/, { timeout: 1000 })
    .catch(() => null);
  await page.locator("#bell").click();
  await page.locator("#center-all").click();
  await page.locator(".search-list .nt-row").first().waitFor();
  await page.locator("#search-dialog[data-source=Notifications]").waitFor();
  await (await asked)?.response();
}
// The list has the hub's matches a frame after its answer.
export async function typed(page, words, type) {
  const answered = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/search" &&
      new URL(response.url()).searchParams.get("q") === words,
  );
  await type();
  await answered;
  await page.evaluate(() => new Promise(requestAnimationFrame));
}
export const menu = (page, name) =>
  page.locator(`[data-menu="${name}"] .search-menu-button`);
export const choice = (page, name, value) =>
  page.locator(`[data-menu="${name}"] [data-value="${value}"]`);
