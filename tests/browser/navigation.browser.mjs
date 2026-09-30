import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, sleep } from "../support/hub.mjs";
import {
  kinds,
  navigationRound,
  sessionTools,
  title,
} from "../support/navigation.mjs";

async function trackedPage(t, url) {
  const page = await open(t, "about:blank");
  if (!page) return null;
  await page.addInitScript(() => {
    window.__submitTrace = [];
    window.__loadingLeaks = [];
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
    const visible = (element) => {
      const style = getComputedStyle(element);
      return (
        !element.hidden &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        element.getClientRects().length > 0
      );
    };
    let previousLeak = "";
    const recordLoading = () => {
      const app = document.querySelector("#app");
      if (!app?.hasAttribute("data-loading")) return;
      const outside = [...(document.body?.children || [])]
        .filter((element) => element !== app && element.tagName !== "SCRIPT")
        .filter(visible)
        .map((element) => element.id || element.tagName.toLowerCase());
      if (getComputedStyle(app).visibility !== "hidden") outside.unshift("app");
      const leak = outside.sort().join(",");
      if (leak && leak !== previousLeak) window.__loadingLeaks.push(leak);
      previousLeak = leak;
    };
    new MutationObserver(record).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    new MutationObserver(recordLoading).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    window.__resetSubmitTrace = () => {
      window.__submitTrace.length = 0;
      previous = undefined;
      record();
    };
    const sample = () => {
      record();
      recordLoading();
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
  assert.deepEqual(
    await page.evaluate(() => window.__loadingLeaks),
    [],
    "only the ground should be visible while the app is loading",
  );
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

async function roundIsShown(page, round) {
  try {
    await page.waitForFunction(
      (number) =>
        document.querySelector("#past-tab")?.getAttribute("aria-selected") ===
          "true" &&
        document.querySelector("#page-content")?.dataset.round === number,
      round,
      { timeout: 10000 },
    );
  } catch (error) {
    const state = await page.evaluate(() => ({
      url: location.href,
      round: document.querySelector("#page-content")?.dataset.round,
      pastSelected: document
        .querySelector("#past-tab")
        ?.getAttribute("aria-selected"),
      title: document.querySelector("#page-title")?.textContent,
    }));
    throw Error(
      `${error.message}; round navigation state: ${JSON.stringify(state)}`,
    );
  }
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
  const roundTwoFeedback = await first.session.feedback(
    first.session.event("feedback-only", "2", { name: "first" }),
  );
  assert.equal(
    roundTwoFeedback.code,
    200,
    JSON.stringify(roundTwoFeedback.body),
  );
  for (const action of ["ack", "read"])
    assert.equal((await first.session.action(action)).code, 200);
  await first.publish("3", navigationRound("3", "First session", "first"));
  await page.goto(first.url("r/1"));
  await assertFirstSubmit(page, {
    visible: false,
    disabled: false,
    text: "Feedback",
    class: "btn header-submit",
  });
  await page.evaluate((sessionId) => {
    localStorage.setItem(
      `pair:place:${sessionId}`,
      JSON.stringify({ tab: "current", past: "1", places: {} }),
    );
  }, first.session.id);
  await page.locator("#history-return").click();
  await page.waitForURL(new RegExp(`${first.session.id}/$`));
  await assertFirstSubmit(page, ready);

  const pageBeforeTabs = await page.evaluate(() => ({
    id: document.querySelector("#page-content").dataset.pageId,
    round: document.querySelector("#page-content").dataset.round,
  }));
  let releaseRoundOne;
  let startRoundOne;
  const roundOneRequest = new Promise((resolve) => {
    startRoundOne = resolve;
  });
  const holdRoundOne = new Promise((resolve) => {
    releaseRoundOne = resolve;
  });
  await page.route("**/api/submission**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("round") === "1") {
      startRoundOne();
      await holdRoundOne;
    }
    await route.continue();
  });
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
    ready,
    async () => {
      await page.locator("#past-tab").click();
      await roundOneRequest;
      await page.locator("#current-tab").click();
    },
    () => page.locator('#current-tab[aria-selected="true"]').waitFor(),
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
    pastButton,
    async () => {
      await page.locator("#round").click();
      const roundTwo = page
        .locator("#round-list .dialog-row")
        .filter({ hasText: "Round 2" });
      const menuState = await page.evaluate(() => ({
        pageRound: document.querySelector("#page-content").dataset.round,
        selectedPast: document
          .querySelector("#past-tab")
          .getAttribute("aria-selected"),
      }));
      assert.equal(
        await roundTwo.evaluate((row) => row.classList.contains("current")),
        false,
        `Round 2 was already marked current: ${JSON.stringify(menuState)}`,
      );
      await roundTwo.click();
    },
    () => roundIsShown(page, "2"),
  );
  const roundOneResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith("/api/submission") &&
      url.searchParams.get("round") === "1"
    );
  });
  releaseRoundOne();
  await roundOneResponse;
  await sleep(100);
  assert.equal(
    await page.locator("#past-tab").textContent(),
    "Round 2",
    "a slower Previous-tab load overrode the newer round selection",
  );
  await page.waitForTimeout(1700);
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
        () => document.querySelector("#page-content").dataset.round === "3",
      ),
  );
});
