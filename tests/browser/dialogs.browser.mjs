import assert from "node:assert/strict";
import { test } from "node:test";
import { open, stubMermaid } from "../support/browser.mjs";
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
  await check("close-dialog", { buttons: ["#close-confirm"] });
  await close("close-dialog");

  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("long"));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  // The frame reads the selection on selectionchange, which the browser
  // fires after this call returns. Until then, c comments on the page.
  await page
    .getByRole("button", { name: "Comment on selection", exact: true })
    .waitFor();
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

// Every dialog backs out the same way: its ×, Escape, or a tap outside,
// which takes the press and the release both on the backdrop. A drag that
// starts inside, such as selecting a field's text or a heading's, and ends
// outside leaves the dialog open.
test("every dialog closes on its ×, on Escape and on a tap outside, and stays open through a drag that ends outside", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  const plan = planData();
  plan.pages[0].html = `<p>Preserve one result per input.</p>
<div data-diagram>flowchart LR
  A --> B</div>
<section class="drawing-question" data-drawing-question="layout" data-label="Layout">
  <h3>Sketch the layout</h3>
  <div class="drawing-stage"><div class="drawing-canvas"><img class="drawing-preview" alt="Saved drawing" hidden /></div><button class="btn" type="button" data-draw>Draw your answer</button></div>
  <p class="renderer-error" data-drawing-error role="status" hidden></p>
</section>`;
  assert.equal((await session.publish(plan)).code, 200);
  const proposed = await session.action("propose", {
    id: "queue",
    title: "Queue the exports",
    delivers: "One export at a time.",
    changes: "The cron jobs.",
    recommend: "here",
    reason: "Two hosts write the same file.",
    source: "From the conversation",
  });
  assert.equal(proposed.code, 200, proposed.body.error);
  const page = await open(t, "about:blank", {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  if (!page) return;
  await stubMermaid(page);
  // The drawing editor loads Excalidraw from esm.sh, and its head works
  // without it.
  await page.route(/esm\.sh/, (route) => route.abort());
  await page.goto(`${h.server.origin}${session.base}/#overview`);
  await page.locator("[data-diagram] svg").waitFor();

  const isOpen = (id) =>
    page.locator(`#${id}`).evaluate((dialog) => dialog.open);
  async function backOut(id, open, press = `#${id} h2`) {
    const dialog = page.locator(`#${id}`);
    const shut = () => dialog.waitFor({ state: "hidden" });
    await open();
    await dialog.waitFor();
    const from = await page.locator(press).boundingBox();
    await page.mouse.move(from.x + 4, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(5, 5, { steps: 4 });
    await page.mouse.up();
    assert.equal(await isOpen(id), true, `${id} after a drag out`);
    await page.touchscreen.tap(5, 5);
    await shut();

    await open();
    await dialog.waitFor();
    await page.keyboard.press("Escape");
    await shut();

    await open();
    await dialog.waitFor();
    await dialog.locator("[data-close]").click();
    await shut();
  }

  await backOut("settings-dialog", () => page.locator("#settings").click());
  await backOut("keys-dialog", () => page.keyboard.press("?"));
  await backOut("round-dialog", () => page.locator("#round").click());
  await backOut("close-dialog", async () => {
    await page.locator("#menu-button").click();
    await page.locator(`[data-key="close:${session.id}"]:visible`).click();
  });
  await backOut(
    "note-dialog",
    () => page.locator("#comment-here").click(),
    "#note-text",
  );
  await backOut("drawing-dialog", () => page.locator("[data-draw]").click());
  await backOut(
    "diagram-dialog",
    () => page.locator("[data-diagram] svg").click(),
    "#diagram-dialog .lightbox-view",
  );
  await page.goto(`${h.server.origin}${session.base}/#work`);
  await backOut(
    "start-dialog",
    () => page.locator("[data-proposal-card=queue] .proposal-start").click(),
    "#start-message",
  );
});
