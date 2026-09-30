import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData, sleep } from "../support/hub.mjs";

// A round whose Overview has a block a page thread can target.
const round = (number) => ({
  ...planData(number),
  pages: [
    {
      id: "overview",
      title: "Overview",
      html: '<p id="result">Preserve one result per input.</p>',
    },
  ],
});
const navigationRound = (number, title, name = "example") => ({
  ...planData(number, undefined, name),
  title,
  pages: [
    {
      id: "overview",
      title: "Overview",
      html: '<p id="result">Preserve one result per input.</p>',
    },
    { id: "details", title: "Details", html: "<p>Keep the details.</p>" },
  ],
});
const kinds = {
  page: { topic: "overview", anchor: "Result line", target: "result" },
  progress: { topic: "agreed", anchor: "Progress", target: "agent-activity" },
};

async function sessionTools(h, session) {
  const url = (rest) => `${h.server.origin}${session.base}/${rest}`;
  const publish = async (number, data = round(number)) =>
    assert.equal((await session.publish(data)).code, 200);
  // The agent reads each submission, as it would before the next round.
  const send = async (number) => {
    const sent = await session.feedback(session.event("feedback-only", number));
    assert.equal(sent.code, 200, JSON.stringify(sent.body));
    for (const step of ["ack", "read"])
      assert.equal((await session.action(step)).code, 200);
  };
  const thread = async (number, kind) => {
    const id = crypto.randomUUID();
    const started = await session.request(`${session.base}/api/threads`, {
      id,
      round: number,
      text: "Where does this land?",
      ...kinds[kind],
    });
    assert.equal(started.code, 201, JSON.stringify(started.body));
    return id;
  };
  // The agent's first reply is the thread's row 1.
  const reply = async (id) =>
    assert.equal(
      (await session.action("reply", { note: id, text: "Here." })).code,
      200,
    );
  return { session, url, publish, send, thread, reply };
}

async function setup(t) {
  const h = await hub(t);
  return sessionTools(h, await h.session());
}

const focused = (page, id) =>
  page.waitForFunction(
    (row) => document.activeElement?.id === row,
    `thread-${id}-1`,
    { timeout: 5000 },
  );
const selected = (page, tab) =>
  page.locator(`#${tab}-tab[aria-selected="true"]`).waitFor({ timeout: 5000 });
const cards = (page, id) =>
  page.locator(`pair-thread[data-thread="${id}"]`).count();
const title = (page, text) =>
  page.locator("#page-title", { hasText: text }).waitFor({ timeout: 5000 });
// The bell marks every event it finds on its first load as seen, so each
// test waits for the bell to show before the agent replies.
const bellReady = (page) => page.locator("#bell").waitFor();
async function bell(page) {
  await page.locator("#bell").click();
  await page.locator("#center-list .session-row").click();
}

async function trackedPage(t, url) {
  const page = await open(t, "about:blank");
  if (!page) return null;
  await page.addInitScript(() => {
    window.__submitTrace = [];
    let previous;
    const record = () => {
      const button = document.querySelector("#submit");
      if (!button) return;
      const visible =
        button.getClientRects().length > 0 &&
        getComputedStyle(button).visibility === "visible" &&
        getComputedStyle(button).display !== "none";
      const value = {
        visible,
        disabled: button.disabled,
        text: button.textContent.trim().replace(/\s+/g, " "),
        class: button.className,
      };
      const signature = JSON.stringify({
        visible: value.visible,
        disabled: value.disabled,
        text: value.text,
        class: value.class,
      });
      if (signature !== previous) {
        window.__submitTrace.push(value);
        previous = signature;
      }
    };
    new MutationObserver(record).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    window.__resetSubmitTrace = () => {
      window.__submitTrace.length = 0;
      previous = undefined;
      record();
    };
    const sample = () => {
      record();
      if (performance.now() < 10000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.route("**/api/status", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    await route.continue();
  });
  await page.goto(url);
  return page;
}

const sentButton = (disabled, text) => ({
  visible: true,
  disabled,
  text,
  class: "btn primary header-submit",
});

async function assertFirstSubmit(page, expected) {
  await page.waitForFunction(
    () => !document.querySelector("#app")?.hasAttribute("data-loading"),
    undefined,
    { timeout: 10000 },
  );
  await page.waitForTimeout(150);
  const trace = await page.evaluate(() => window.__submitTrace);
  assert.ok(trace.length, "the submit button was never recorded");
  const visible = trace.filter((state) => state.visible);
  const first = visible[0] || trace.at(-1);
  assert.deepEqual(first, expected, "the first painted state was wrong");
  if (expected.visible)
    assert.deepEqual(
      visible,
      visible.map(() => expected),
      "the submit button changed after it became visible",
    );
  else assert.deepEqual(visible, []);
}

async function assertStableSubmit(page, expected, action, ready) {
  await page.evaluate(() => window.__resetSubmitTrace());
  await action();
  await ready();
  await page.waitForTimeout(100);
  const visible = await page.evaluate(() =>
    window.__submitTrace.filter((state) => state.visible),
  );
  assert.ok(
    visible.length,
    "the submit button was not visible after navigation",
  );
  assert.deepEqual(visible[0], expected);
  assert.deepEqual(
    visible,
    visible.map(() => expected),
    "the submit button changed after navigation",
  );
}

async function addNote(page) {
  const paragraph = page.locator("#page-content #result");
  await paragraph.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.keyboard.press("c");
  await page.locator("#note-text").fill("Keep the result.");
  await page.getByRole("button", { name: "Add to feedback" }).click();
  await page.locator("#note-dialog").waitFor({ state: "hidden" });
}

test("the submit control is settled on first paint across navigation", async (t) => {
  const h = await hub(t);
  const first = await sessionTools(h, await h.session());
  const second = await sessionTools(h, await h.session());
  await first.publish("1", navigationRound("1", "First session", "first"));
  await second.publish("1", navigationRound("1", "Second session", "second"));

  const page = await trackedPage(t, first.url("#overview"));
  if (!page) return;
  const ready = sentButton(false, "Send feedback");
  const noted = sentButton(false, "Send feedback (1)");
  await assertFirstSubmit(page, ready);
  await addNote(page);
  await page.waitForFunction(
    () =>
      document.querySelector("#submit")?.textContent.trim() ===
      "Send feedback (1)",
  );

  const thread = await first.thread("1", "page");
  await first.reply(thread);
  await page.locator("#menu-button").click();
  await page
    .locator("#sessions-list .sess-row")
    .filter({ hasText: "Second session" })
    .click();
  await page.waitForURL(new RegExp(second.session.id));
  await assertFirstSubmit(page, ready);

  await page.waitForFunction(
    () => document.querySelector("#bell-count")?.textContent === "1",
    undefined,
    { timeout: 10000 },
  );
  await page.locator("#bell").click();
  await page.locator("#center-list .session-row").click();
  await page.waitForURL(new RegExp(first.session.id));
  await assertFirstSubmit(page, noted);

  await assertStableSubmit(
    page,
    noted,
    () => page.locator('#page-list [data-page="details"]').click(),
    () => title(page, "Details"),
  );
  await assertStableSubmit(
    page,
    noted,
    () => page.locator('#page-list [data-page="overview"]').click(),
    () => title(page, "Overview"),
  );

  await page.locator('#page-list [data-page="feedback"]').click();
  await page.locator("#feedback").waitFor({ state: "visible" });
  await page.locator("#submit").click();
  await page.waitForFunction(
    () =>
      !document.querySelector("#reading").hidden &&
      document.querySelector("#feedback").hidden,
  );
  for (const action of ["ack", "read"])
    assert.equal((await first.session.action(action)).code, 200);
  await first.publish("2", navigationRound("2", "First session", "first"));
  await page.goto(first.url("r/1"));
  await assertFirstSubmit(page, {
    visible: false,
    disabled: false,
    text: "Feedback",
    class: "btn header-submit",
  });
  await page.locator("#history-return").click();
  await page.waitForURL(new RegExp(`${first.session.id}/$`));
  await assertFirstSubmit(page, ready);

  const pageBeforeTabs = await page.evaluate(() => ({
    id: document.querySelector("#page-content").dataset.pageId,
    round: document.querySelector("#page-content").dataset.round,
  }));
  await assertStableSubmit(
    page,
    ready,
    () => page.locator("#past-tab").click(),
    () => page.locator('#past-tab[aria-selected="true"]').waitFor(),
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      id: document.querySelector("#page-content").dataset.pageId,
      round: document.querySelector("#page-content").dataset.round,
    })),
    pageBeforeTabs,
  );
  await assertStableSubmit(
    page,
    ready,
    () => page.locator("#current-tab").click(),
    () => page.locator('#current-tab[aria-selected="true"]').waitFor(),
  );
  assert.deepEqual(
    await page.evaluate(() => ({
      id: document.querySelector("#page-content").dataset.pageId,
      round: document.querySelector("#page-content").dataset.round,
    })),
    pageBeforeTabs,
  );

  const pastButton = sentButton(false, "Send feedback");
  await page.evaluate(() => {
    window.__historyReturnTrace = [];
    let previous;
    const sample = () => {
      const button = document.querySelector("#history-return");
      const state = {
        hidden: button.hidden,
        stripHidden: document.querySelector("#history-strip").hidden,
        round: document.querySelector("#page-content").dataset.round,
        pastSelected: document
          .querySelector("#past-tab")
          .getAttribute("aria-selected"),
      };
      if (state.pastSelected === "true") {
        const signature = JSON.stringify(state);
        if (signature !== previous) {
          window.__historyReturnTrace.push(state);
          previous = signature;
        }
      }
    };
    window.__sampleHistoryReturn = setInterval(sample, 50);
  });
  await assertStableSubmit(
    page,
    pastButton,
    async () => {
      await page.locator("#round").click();
      await page
        .locator("#round-list .dialog-row")
        .filter({ hasText: "Round 1" })
        .click();
    },
    async () => {
      await page.waitForFunction(
        () => document.querySelector("#page-content").dataset.round === "1",
      );
      await page.waitForTimeout(1700);
    },
  );
  const returnStates = await page.evaluate(() => {
    clearInterval(window.__sampleHistoryReturn);
    return window.__historyReturnTrace;
  });
  assert.ok(returnStates.length, "the past round was never selected");
  assert.deepEqual(
    returnStates,
    returnStates.map((state) => ({
      ...state,
      hidden: false,
      stripHidden: false,
    })),
    "Back to current changed after the past round appeared",
  );
  await assertStableSubmit(
    page,
    ready,
    () => page.locator("#history-return").click(),
    () =>
      page.waitForFunction(
        () => document.querySelector("#page-content").dataset.round === "2",
      ),
  );
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
