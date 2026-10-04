import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData } from "../support/hub.mjs";

const sentence =
  "The export pipeline runs as eleven nightly cron jobs on two hosts, and each job writes its own lock file, so a slow run on one host can overlap the next night's run on the other and write the same CSV twice. ";
const clip = (text, length) => text.repeat(4).slice(0, length);

// On a 375 by 667 phone every dialog stays the same distance from each edge
// of the window, whatever the length of the agent's text, and its title and
// buttons stay in view while a body taller than the window scrolls inside.
test("every dialog keeps one margin from each edge of a phone's window and its buttons in view", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  const plan = planData();
  plan.title = clip(sentence, 160);
  plan.pages[0].html = `<p id="long">${sentence.repeat(8)}</p>`;
  assert.equal((await session.publish(plan)).code, 200);
  const proposed = await session.action("propose", {
    id: "queue",
    title: clip(sentence, 80),
    delivers: clip(sentence, 400),
    changes: clip(sentence, 400),
    recommend: "here",
    reason: clip(sentence, 400),
    source: "From the conversation",
  });
  assert.equal(proposed.code, 200, proposed.body.error);
  const page = await open(t, `${h.server.origin}${session.base}/#overview`, {
    viewport: { width: 375, height: 667 },
  });
  if (!page) return;
  await page.locator("#long").waitFor();

  // The first dialog's left margin is the one every side of every dialog
  // keeps. tall: the dialog's text is taller than the window, so the
  // dialog reaches the margin above and below as well.
  let margin;
  async function check(id, { tall = false, buttons = [] } = {}) {
    const dialog = page.locator(`#${id}`);
    await dialog.waitFor();
    const box = await dialog.boundingBox();
    margin ??= box.x;
    assert.ok(margin > 0, `${id} left ${box.x}`);
    const top = box.y;
    const right = 375 - box.x - box.width;
    const bottom = 667 - box.y - box.height;
    const near = (a, b) => Math.abs(a - b) < 0.5;
    assert.ok(near(box.x, margin), `${id} left ${box.x}`);
    assert.ok(near(right, margin), `${id} right ${right}`);
    assert.ok(near(top, bottom), `${id} top ${top}, bottom ${bottom}`);
    if (tall) assert.ok(near(top, margin), `${id} top ${top}`);
    else assert.ok(top >= margin, `${id} top ${top}`);
    for (const selector of [`#${id} h2`, ...buttons]) {
      const inner = await page.locator(selector).boundingBox();
      assert.ok(
        inner.x >= box.x &&
          inner.y >= box.y &&
          inner.x + inner.width <= box.x + box.width &&
          inner.y + inner.height <= box.y + box.height,
        `${selector} in view in ${id}`,
      );
    }
  }
  const close = async (id) => {
    await page.keyboard.press("Escape");
    await page.locator(`#${id}`).waitFor({ state: "hidden" });
  };

  await page.locator("#settings").click();
  await check("settings-dialog");
  await close("settings-dialog");
  await page.keyboard.press("?");
  await check("keys-dialog");
  await close("keys-dialog");
  await page.locator("#round").click();
  await check("round-dialog");
  await close("round-dialog");

  await page.locator("#menu-button").click();
  await page.locator(`[data-key="close:${session.id}"]:visible`).click();
  await check("close-dialog", {
    buttons: ["#close-dialog .actions [data-close]", "#close-confirm"],
  });
  await close("close-dialog");

  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("long"));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  // The frame reads the selection on selectionchange, which the browser
  // fires after this call returns. Until then, c comments on the page.
  await page.getByRole("button", { name: "Comment", exact: true }).waitFor();
  await page.keyboard.press("c");
  await page.locator("#note-quote").waitFor();
  await check("note-dialog", {
    tall: true,
    buttons: ["#note-thread", "#note-save"],
  });
  await close("note-dialog");

  await page.goto(`${h.server.origin}${session.base}/#work`);
  await page.locator("[data-proposal-card=queue] .proposal-start").click();
  await check("start-dialog", { tall: true, buttons: ["#start-send"] });
  await page.locator("[data-where=new-agent]").click();
  await check("start-dialog", {
    tall: true,
    buttons: ["#start-copy", "#start-open"],
  });
  await close("start-dialog");
});
