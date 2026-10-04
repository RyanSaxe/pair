import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData, sleep } from "../support/hub.mjs";

// A session with one sub-session started from its card "work".
async function withSubSession(h, title) {
  const parent = await h.session();
  assert.equal((await parent.publish({ ...planData(), title })).code, 200);
  const proposed = await parent.action("propose", {
    id: "work",
    title: `${title} work`,
    delivers: "The work.",
    changes: "Only its own files.",
    recommend: "sub-session",
    reason: "It runs apart.",
    source: "From the conversation",
  });
  assert.equal(proposed.code, 200, proposed.body.error);
  const started = await parent.request(
    `${parent.base}/api/proposals/work/start`,
    { where: "sub-session" },
  );
  assert.equal(started.code, 200, started.body.error);
  const child = await h.session({
    start: true,
    from: parent.directory,
    proposal: "work",
  });
  const sub = `${title} sub-session`;
  assert.equal((await child.publish({ ...planData(), title: sub })).code, 200);
  return [parent, child];
}

test("Sessions numbers only the sessions that are not sub-sessions, the number keys open those, and w still reaches a sub-session", async (t) => {
  const h = await hub(t);
  // The frame lists sessions in the order they started.
  const [own, ownSub] = await withSubSession(h, "Own");
  await sleep(20);
  const [closed] = await withSubSession(h, "Closed");
  await sleep(20);
  const last = await h.session();
  assert.equal(
    (await last.publish({ ...planData(), title: "Last" })).code,
    200,
  );
  // A closed session stays listed while its sub-session is open.
  assert.equal(
    (await closed.request(`${closed.base}/api/dismiss`, {})).code,
    200,
  );

  const ownUrl = `${h.server.origin}${own.base}/`;
  const page = await open(t, ownUrl);
  if (!page) return;
  await page.locator("#menu-button").click();
  const rows = page.locator("#sessions-list .sess-line");
  await page.waitForFunction(
    () => document.querySelectorAll("#sessions-list .sess-line").length === 5,
  );
  assert.deepEqual(
    await rows.evaluateAll((lines) =>
      lines.map((line) => [
        line.querySelector(".sess-row").firstElementChild.textContent,
        line.querySelector(".t").textContent,
      ]),
    ),
    [
      ["1", "Own"],
      ["", "↳Own sub-session"],
      ["", "Closed"],
      ["", "↳Closed sub-session"],
      ["2", "Last"],
    ],
  );
  // The closed session's mark sits in the number column, and each session
  // that is not a sub-session sits further from the row above than a
  // sub-session sits from its parent.
  const layout = await rows.evaluateAll((lines) => {
    const box = (element) => element.getBoundingClientRect();
    return {
      number: box(lines[0].querySelector(".n")),
      mark: box(lines[2].querySelector(".n svg")),
      gaps: lines
        .slice(1)
        .map((line, index) => box(line).top - box(lines[index]).bottom),
    };
  });
  assert.ok(
    layout.mark.width > 0 &&
      layout.mark.left >= layout.number.left &&
      layout.mark.right <= layout.number.right,
    `the mark spans ${layout.mark.left} to ${layout.mark.right}, the number column ${layout.number.left} to ${layout.number.right}`,
  );
  const [ownSubGap, closedGap, closedSubGap, lastGap] = layout.gaps;
  assert.ok(
    Math.min(closedGap, lastGap) > Math.max(ownSubGap, closedSubGap),
    `gaps above each row: ${layout.gaps.join(", ")}`,
  );
  // With no buttons on its row, Closed ends in the Close column.
  const closedEnd = await rows
    .nth(2)
    .locator(".pill")
    .evaluate((pill) => pill.getBoundingClientRect().right);
  const closeColumn = await rows
    .nth(3)
    .locator('[data-key^="close:"]')
    .evaluate((button) => button.getBoundingClientRect());
  assert.ok(
    closedEnd > closeColumn.left && closedEnd <= closeColumn.right,
    `Closed ends at ${closedEnd}, the Close column spans ${closeColumn.left} to ${closeColumn.right}`,
  );
  await page.keyboard.press("Escape");

  await page.keyboard.press("2");
  await page.waitForURL(`${h.server.origin}${last.base}/`);
  await page.goto(ownUrl);
  await page.waitForFunction(
    () => document.querySelectorAll("#sessions-list .sess-line").length === 5,
  );
  await page.keyboard.press("w");
  await page.waitForURL(`${h.server.origin}${ownSub.base}/`);
});
