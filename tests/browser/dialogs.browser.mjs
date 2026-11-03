import assert from "node:assert/strict";
import { test } from "node:test";
import { open, stubPele } from "../support/browser.mjs";
import { hub, planData } from "../support/hub.mjs";

const sentence =
  "The export pipeline runs as eleven nightly cron jobs on two hosts, and each job writes its own lock file, so a slow run on one host can overlap the next night's run on the other and write the same CSV twice. ";
const clip = (text, length) => text.repeat(4).slice(0, length);

// The test fills each dialog with text taller than a 375 by 667 window, so the
// body must scroll inside the dialog while its title and buttons stay in view.
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
    recommend: "here",
  });
  assert.equal(proposed.code, 200, proposed.body.error);
  const page = await open(t, `${h.server.origin}${session.base}/#overview`, {
    viewport: { width: 375, height: 667 },
  });
  if (!page) return;
  await page.locator("#long").waitFor();

  // check() compares every side of every dialog with the first dialog's left
  // margin. With tall set, the dialog's text is taller than the window, so the
  // dialog also reaches the margin above and below.
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

  await page.keyboard.press("?");
  await check("keys-dialog");
  await close("keys-dialog");

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
  // The frame reads the selection on selectionchange, which the browser fires
  // after this call returns. Until then, the c key comments on the whole page.
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

// The session title is too long for the Rounds panel, so the test also checks
// that the frame keeps that panel inside the window.
test("each top bar panel opens under its button inside the window, one at a time, and closes on its button, on Escape and on a click outside", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  const plan = planData();
  plan.title = clip(sentence, 160);
  assert.equal((await session.publish(plan)).code, 200);
  const page = await open(t, `${h.server.origin}${session.base}/#overview`);
  if (!page) return;
  const panels = [
    ["menu-button", "sessions-pop"],
    ["round", "rounds-pop"],
    ["settings", "settings-pop"],
    ["bell", "center-pop"],
  ];
  const shown = () =>
    page.evaluate(
      (ids) =>
        ids.filter((id) =>
          document.getElementById(id).matches(":popover-open"),
        ),
      panels.map(([, panel]) => panel),
    );
  const closed = (panel) =>
    page.locator(`#${panel}`).waitFor({ state: "hidden" });

  for (const viewport of [
    { width: 375, height: 667 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${h.server.origin}${session.base}/#overview`);
    await page.locator("#bell:not([hidden])").waitFor();
    for (const [button, panel] of panels) {
      const at = `${panel} at ${viewport.width}px`;
      await page.locator(`#${button}`).click();
      await page.locator(`#${panel}`).waitFor();
      assert.deepEqual(await shown(), [panel], at);
      await page.locator(`#${button}[aria-expanded="true"]`).waitFor();
      const anchor = await page.locator(`#${button}`).boundingBox();
      const box = await page.locator(`#${panel}`).boundingBox();
      const near = (a, b) => Math.abs(a - b) < 0.5;
      assert.ok(near(box.y, anchor.y + anchor.height + 6), `${at} top`);
      assert.ok(box.x >= 7.5, `${at} left ${box.x}`);
      assert.ok(
        box.x + box.width <= viewport.width - 7.5,
        `${at} right ${box.x + box.width}`,
      );
      if (anchor.x + box.width <= viewport.width - 8)
        assert.ok(near(box.x, anchor.x), `${at} left ${box.x}`);
    }
    for (const [button, panel] of panels) {
      await page.locator(`#${button}`).click();
      await page.locator(`#${panel}`).waitFor();
      await page.locator(`#${button}`).click();
      await closed(panel);
      await page.locator(`#${button}`).click();
      await page.locator(`#${panel}`).waitFor();
      await page.keyboard.press("Escape");
      await closed(panel);
      await page.locator(`#${button}`).click();
      await page.locator(`#${panel}`).waitFor();
      await page.mouse.click(10, viewport.height - 10);
      await closed(panel);
      await page.locator(`#${button}[aria-expanded="false"]`).waitFor();
    }
  }
});

// The frame closes a dialog on a tap outside only when both the press and the
// release land on the backdrop. A drag that starts inside and ends outside,
// such as a text selection, must leave the dialog open.
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
    recommend: "here",
  });
  assert.equal(proposed.code, 200, proposed.body.error);
  const page = await open(t, "about:blank", {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  if (!page) return;
  await stubPele(page);
  // The drawing editor loads Excalidraw from esm.sh. The test blocks esm.sh
  // because the dialog's head must work without the editor.
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

  await backOut("keys-dialog", () => page.keyboard.press("?"));
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
