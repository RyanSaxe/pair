import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData, sleep, waitUntil } from "../support/hub.mjs";

// Each row replaces the browser's copy with a recording of what it would write,
// so a test run leaves the developer's clipboard as it was. A phone reaches the
// hub over plain http, where the browser has no navigator.clipboard, and the
// frame then copies from a selected field.
const copies = [
  {
    name: "with the clipboard API",
    options: {},
    record: () => {
      navigator.clipboard.writeText = async (text) => {
        window.copied = text;
      };
    },
    result: "Copied",
  },
  {
    name: "on a 375px phone with no clipboard API",
    options: { viewport: { width: 375, height: 812 } },
    record: () => {
      Object.defineProperty(navigator, "clipboard", { value: undefined });
      document.addEventListener("copy", (event) => {
        window.copied = event.target.value;
        event.preventDefault();
      });
    },
    result: "Copied",
  },
  {
    name: "when the browser refuses both ways to copy",
    options: { viewport: { width: 375, height: 812 } },
    record: () => {
      Object.defineProperty(navigator, "clipboard", { value: undefined });
      document.execCommand = () => false;
    },
    result: "Copy failed",
  },
];
for (const { name, options, record, result } of copies)
  test(`Reopen ${name} gives the reviewer the command, and the tab comes back live when an agent runs it`, async (t) => {
    const h = await hub(t);
    const session = await h.session();
    assert.equal((await session.publish(planData())).code, 200);
    assert.equal(
      (await session.request(`${session.base}/api/dismiss`, {})).code,
      200,
    );
    const page = await open(t, `${h.server.origin}${session.base}/`, options);
    if (!page) return;
    await page.evaluate(record);
    const button = page.locator("#history-reopen");
    await button.click();
    await page.getByRole("button", { name: result }).waitFor();
    const command = `pair start --reopen --session-dir ${session.directory}`;
    const shown = page.locator("#reopen-command");
    if (result === "Copied") {
      assert.equal(await page.evaluate(() => window.copied), command);
      assert.equal(await shown.isHidden(), true);
      assert.equal(
        await page.locator("#history-label").textContent(),
        "Paste it into any agent to reopen",
      );
    } else assert.equal(await shown.locator("code").textContent(), command);
    // The strip redraws on every poll and keeps what the click showed, and
    // nothing changes until an agent runs the command.
    await sleep(1700);
    assert.equal(await button.textContent(), result);
    assert.equal((await session.status()).body.stage, "complete");

    const reload = page.waitForEvent("load");
    const started = await h.register(session.directory, session.inbox.target, {
      start: true,
      reopen: true,
    });
    assert.equal(started.code, 200, started.body.error);
    await reload;
    await page.locator("#history-strip").waitFor({ state: "hidden" });
    assert.equal(await shown.isHidden(), true);
    await page.locator("#submit").click();
    await page.locator("#send-button").click();
    assert.equal(
      await waitUntil(
        async () => (await session.status()).body.stage === "submitted",
      ),
      true,
    );
    assert.equal((await session.action("read")).code, 200);
  });

test("a closed session with no round comes back live in its open tab", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal(
    (await session.request(`${session.base}/api/dismiss`, {})).code,
    200,
  );
  const page = await open(t, `${h.server.origin}${session.base}/`);
  if (!page) return;
  await page.locator("#history-reopen").waitFor();
  const reload = page.waitForEvent("load");
  await h.register(session.directory, session.inbox.target, {
    start: true,
    reopen: true,
  });
  await reload;
  await page.locator("#agent-activity").waitFor();
  assert.equal(await page.locator("#history-strip").isHidden(), true);
});

test("Close on this tab's own row asks first, then the tab turns read-only and names the session", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  const page = await open(t, `${h.server.origin}${session.base}/#overview`);
  if (!page) return;
  const closes = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/dismiss")) closes.push(request.url());
  });
  const close = page.locator(`[data-key="close:${session.id}"]:visible`);
  await page.locator("#menu-button").click();
  await close.click();
  const dialog = page.locator("#close-dialog");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(await dialog.evaluate((element) => element.open), false);
  assert.deepEqual(closes, []);
  assert.notEqual((await session.status()).body.stage, "complete");

  await page.locator("#menu-button").click();
  await close.click();
  const reload = page.waitForEvent("load");
  await page.locator("#close-confirm").click();
  await reload;
  assert.equal(closes.length, 1);
  assert.equal((await session.status()).body.stage, "complete");
  await page.locator("#history-strip:not([hidden])").waitFor();
  assert.equal(
    await page.locator("#history-label").textContent(),
    "Example work is closed",
  );
});

test("closing a session before its first round turns its tabs read-only and names the session", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  const url = `${h.server.origin}${session.base}/`;
  const own = await open(t, url);
  if (!own) return;
  const phone = await open(t, url, { viewport: { width: 375, height: 812 } });
  await phone.locator("#agent-activity:not([hidden])").waitFor();

  await own.locator("#menu-button").click();
  await own.locator(`[data-key="close:${session.id}"]:visible`).click();
  await own.locator("#close-confirm").click();

  for (const page of [own, phone]) {
    await page.locator("#history-strip:not([hidden])").waitFor();
    assert.equal(
      await page.locator("#history-label").textContent(),
      "New session is closed",
    );
    assert.equal(await page.locator("#agent-activity").isHidden(), true);
    assert.equal(await page.locator("#submit").isHidden(), true);
  }
  // The frame reloads a live home view whose status says the session closed, so
  // the closed page must not reload on that status, or it reloads on every poll.
  let loads = 0;
  own.on("load", () => loads++);
  await sleep(2000);
  assert.equal(loads, 0);
});

// On a phone the frame shortens only the session's long title, and "is closed"
// stays whole.
test("a closed session's line under the header stays one line on a phone", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  const title =
    "Merge the ten 0.3 pull requests into develop in order and release 0.3 to npm";
  assert.equal((await session.publish({ ...planData(), title })).code, 200);
  assert.equal(
    (await session.request(`${session.base}/api/dismiss`, {})).code,
    200,
  );
  const page = await open(t, `${h.server.origin}${session.base}/`, {
    viewport: { width: 390, height: 844 },
  });
  if (!page) return;
  await page.locator("#history-strip:not([hidden])").waitFor();
  const line = await page.locator("#history-label").evaluate((label) => ({
    height: label.getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(label).lineHeight),
    cut: [...label.children]
      .filter((part) => part.scrollWidth > part.clientWidth)
      .map((part) => part.textContent),
  }));
  assert.ok(line.height < line.lineHeight * 1.5, JSON.stringify(line));
  assert.deepEqual(line.cut, [title]);
});

// The hub refuses every reply in a closed session, so a card the agent did not
// answer stops saying that it will.
test("in a closed session, a thread the agent did not answer says the reviewer closed the session first", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  assert.equal((await session.publish(planData())).code, 200);
  const start = async (text) => {
    const id = crypto.randomUUID();
    const started = await session.request(`${session.base}/api/threads`, {
      id,
      round: "1",
      topic: "overview",
      anchor: "Overview",
      text,
    });
    assert.equal(started.code, 201, started.body.error);
    return id;
  };
  const sent = await start("Is one result enough?");
  const read = await start("What about a failed input?");
  const replied = await start("Does order matter?");
  assert.equal(
    await waitUntil(async () =>
      (await session.status()).body.threads.every(
        (thread) => thread.state === "sent",
      ),
    ),
    true,
  );
  assert.equal((await session.action("reply", { note: read })).code, 200);
  const answered = await session.action("reply", {
    note: replied,
    text: "It keeps the input order.",
  });
  assert.equal(answered.code, 200, answered.body.error);
  assert.equal(
    (await session.request(`${session.base}/api/dismiss`, {})).code,
    200,
  );

  const page = await open(t, `${h.server.origin}${session.base}/#overview`);
  if (!page) return;
  const status = async (id) => {
    const card = page.locator(`pair-thread[data-thread="${id}"]`);
    await card.waitFor();
    return card.locator(".thread-status").textContent();
  };
  const closed = "You closed the session before the agent replied.";
  assert.equal(await status(sent), closed);
  assert.equal(await status(read), closed);
  assert.equal(await status(replied), "");
});
