import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData, sleep } from "../support/hub.mjs";
import {
  bell,
  bellReady,
  cards,
  focused,
  navigationRound,
  selected,
  sessionTools,
  setup,
  title,
} from "../support/navigation.mjs";

async function targetPage(t, url) {
  const page = await open(t, "about:blank");
  if (!page) return null;
  await page.addInitScript(() => {
    window.__loadingLeaks = [];
    window.__appRevealState = null;
    const visible = (element) => {
      const style = getComputedStyle(element);
      return (
        !element.hidden &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        element.getClientRects().length > 0
      );
    };
    const onScreen = (element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < innerHeight &&
        rect.right > 0 &&
        rect.left < innerWidth
      );
    };
    let previousLeak = "";
    const record = () => {
      const app = document.querySelector("#app");
      if (!app) return;
      if (app.hasAttribute("data-loading")) {
        const outside = [...(document.body?.children || [])]
          .filter((element) => element !== app && element.tagName !== "SCRIPT")
          .filter(visible)
          .map((element) => element.id || element.tagName.toLowerCase());
        if (getComputedStyle(app).visibility !== "hidden")
          outside.unshift("app");
        const leak = outside.sort().join(",");
        if (leak && leak !== previousLeak) window.__loadingLeaks.push(leak);
        previousLeak = leak;
        return;
      }
      if (window.__appRevealState) return;
      const targetId = new URL(location.href).searchParams.get("target");
      const target = targetId && document.getElementById(targetId);
      window.__appRevealState = {
        targetId,
        targetFound: Boolean(target),
        targetVisible: target ? visible(target) : false,
        targetOnScreen: target ? onScreen(target) : false,
        diagramRendered: Boolean(
          document.querySelector("#page-content [data-diagram] svg"),
        ),
      };
    };
    new MutationObserver(record).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    const sample = () => {
      record();
      if (!window.__appRevealState) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto(url);
  return page;
}

async function assertTargetAtReveal(page, id) {
  await page.waitForFunction(
    () => window.__appRevealState !== null,
    undefined,
    { timeout: 10000 },
  );
  const state = await page.evaluate(() => window.__appRevealState);
  assert.deepEqual(
    await page.evaluate(() => window.__loadingLeaks),
    [],
    "only the ground should be visible while the app is loading",
  );
  assert.equal(state.targetId, id);
  assert.ok(state.targetFound, "notification target was absent at reveal");
  assert.ok(
    state.targetVisible && state.targetOnScreen,
    `notification target was not on screen at reveal: ${JSON.stringify(state)}`,
  );
  assert.ok(state.diagramRendered, "the diagram was not ready at reveal");
}

test("following a notification reveals its target with the page", async (t) => {
  const h = await hub(t);
  const targetSession = await sessionTools(h, await h.session());
  const readerSession = await sessionTools(h, await h.session());
  await targetSession.publish("1", {
    ...planData("1", undefined, "target"),
    title: "Target session",
    pages: [
      {
        id: "guide",
        title: "Guide",
        html: `<p id="result">The response is stable.</p>
          <div data-chart data-title="Response time">{"xAxis":{"type":"category","data":["A","B"]},"yAxis":{"type":"value"},"series":[{"type":"line","data":[1,2]}]}</div>
          <div data-diagram>flowchart LR\nRequest --> Response</div>`,
      },
    ],
  });
  await readerSession.publish(
    "1",
    navigationRound("1", "Reader session", "reader"),
  );

  const page = await targetPage(t, readerSession.url("#overview"));
  if (!page) return;
  await bellReady(page);
  const thread = await targetSession.thread("1", "guide");
  await targetSession.reply(thread);
  await page.waitForFunction(
    () => document.querySelector("#bell-count")?.textContent === "1",
    undefined,
    { timeout: 10000 },
  );
  await page.locator("#bell").click();
  await page.locator("#center-list .session-row").click();
  await page.waitForURL(new RegExp(targetSession.session.id));
  await assertTargetAtReveal(page, `thread-${thread}-1`);
});

test("a Progress reply's link opens its card and focuses the reply", async (t) => {
  const s = await setup(t);
  await s.publish("1");
  const id = await s.thread("1", "progress");
  await s.reply(id);
  const page = await open(t, s.url(`?target=thread-${id}-1#agreed`));
  if (!page) return;
  await focused(page, id);
  const card = page.locator(`pair-thread[data-thread="${id}"]`);
  assert.equal(await card.getAttribute("collapsed"), null);
});

test("a reply in the round just sent opens under Previous", async (t) => {
  const s = await setup(t);
  await s.publish("1");
  const onPage = await s.thread("1", "page");
  const onProgress = await s.thread("1", "progress");
  await s.send("1");
  const page = await open(t, s.url("#agreed"));
  if (!page) return;
  await bellReady(page);
  await s.reply(onPage);
  await bell(page);
  await selected(page, "past");
  await page.locator("#past-tab", { hasText: "Round 1" }).waitFor();
  await title(page, "Overview");
  await focused(page, onPage);
  await s.reply(onProgress);
  await page.goto(s.url(`?target=thread-${onProgress}-1#agreed`));
  await selected(page, "past");
  await title(page, "Agreed so far");
  await focused(page, onProgress);
});

test("a reply in an older round opens under Previous, not /r/", async (t) => {
  const s = await setup(t);
  await s.publish("1");
  const id = await s.thread("1", "page");
  await s.send("1");
  await s.publish("2");
  await s.send("2");
  const page = await open(t, s.url("#agreed"));
  if (!page) return;
  await bellReady(page);
  await s.reply(id);
  await bell(page);
  await selected(page, "past");
  await page.locator("#past-tab", { hasText: "Round 1" }).waitFor();
  await focused(page, id);
  assert.doesNotMatch(page.url(), /\/r\//);
});

test("each Progress thread has one card, and none while Current waits", async (t) => {
  const s = await setup(t);
  await s.publish("1");
  const first = await s.thread("1", "progress");
  await s.reply(first);
  const page = await open(t, s.url("#agreed"));
  if (!page) return;
  await page.locator(`pair-thread[data-thread="${first}"]`).waitFor();
  const agreed = page.locator('#page-list [data-page="agreed"]');
  await agreed.click();
  await agreed.click();
  await page.keyboard.press("a");
  assert.equal(await cards(page, first), 1);
  await s.send("1");
  await page.reload();
  const second = await s.thread("1", "progress");
  await s.reply(second);
  // Two status polls.
  await sleep(3000);
  assert.equal(await cards(page, first), 0);
  assert.equal(await cards(page, second), 0);
  await page.locator("#past-tab").click();
  await agreed.click();
  await page.locator(`pair-thread[data-thread="${second}"]`).waitFor();
  assert.equal(await cards(page, first), 1);
  assert.equal(await cards(page, second), 1);
});

test("Back to current opens the waiting Agreed, not an empty Review", async (t) => {
  const s = await setup(t);
  await s.publish("1");
  const page = await open(t, s.url("#feedback"));
  if (!page) return;
  // The frame saves feedback as round 1's place.
  await page.locator("#feedback").waitFor();
  await s.send("1");
  const waiting = async () => {
    await page.locator("#reading").waitFor();
    assert.equal(await page.evaluate(() => location.hash), "#agreed");
    assert.equal(await page.locator("#feedback").isVisible(), false);
  };
  await page.goto(s.url("r/1"));
  await page.locator("#history-return").click();
  await page.waitForURL(/\/s\/[^/]+\/(#.*)?$/);
  await waiting();
  await page.goto(s.url("#feedback"));
  await waiting();
});
