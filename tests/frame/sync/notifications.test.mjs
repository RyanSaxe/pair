import assert from "node:assert/strict";
import test from "node:test";
import {
  createReviewAlerts,
  reviewAlert,
  wakeAlert,
} from "../../../src/frame/sync/notifications.mjs";

function alertFixture({
  storage = new Map(),
  permission = "default",
  supported = true,
  blockedStorage = false,
  locks,
  sessionId = "s1",
  focused = false,
} = {}) {
  const sent = [],
    opened = [];
  let requests = 0;
  class Notification {
    static permission = permission;
    static async requestPermission() {
      requests++;
      return (this.permission = "granted");
    }
    constructor(title, options) {
      this.title = title;
      this.options = options;
      sent.push(this);
    }
    close() {
      this.closed = true;
    }
  }
  const document = Object.assign(new EventTarget(), {
    hidden: !focused,
    title: "",
    hasFocus: () => focused,
  });
  const host = Object.assign(new EventTarget(), {
    document,
    Notification: supported ? Notification : undefined,
    isSecureContext: true,
    location: { protocol: "http:" },
    navigator: { locks },
    focus() {},
    localStorage: {
      getItem(key) {
        if (blockedStorage) throw Error("blocked");
        return storage.get(key);
      },
      setItem(key, value) {
        if (blockedStorage) throw Error("blocked");
        storage.set(key, value);
      },
    },
  });
  const button = {};
  const alerts = createReviewAlerts({
    window: host,
    button,
    sessionId,
    open: (url) => opened.push(url),
  });
  const entry = (id, round, extra = {}) => ({
    id,
    title: `Plan ${id}`,
    round,
    stage: "updated",
    needsYou: true,
    publishedAt: new Date().toISOString(),
    url: `/s/${id}/`,
    ...extra,
  });
  return {
    alerts,
    host,
    button,
    sent,
    opened,
    entry,
    requests: () => requests,
  };
}

const later = () => new Date(Date.now() + 1000).toISOString();

test("alerts announce other sessions once across tabs and never the focused session", async () => {
  const storage = new Map();
  let queue = Promise.resolve();
  const locks = { request: (_key, callback) => (queue = queue.then(callback)) };
  const a = alertFixture({ storage, locks, sessionId: "s1", focused: true });
  const b = alertFixture({
    storage,
    locks,
    sessionId: "s2",
    permission: "granted",
  });
  await a.button.onclick();
  assert.equal(a.requests(), 1);
  const s1 = a.entry("s1", "2", { publishedAt: later() });
  await Promise.all([a.alerts.update([s1]), b.alerts.update([s1])]);
  assert.equal(a.sent.length + b.sent.length, 0);
  const s3 = a.entry("s3", "1", { publishedAt: later() });
  await Promise.all([a.alerts.update([s1, s3]), b.alerts.update([s1, s3])]);
  assert.equal(a.sent.length + b.sent.length, 1);
  const item = a.sent[0] || b.sent[0];
  assert.equal(item.title, "Round 1 is ready");
  assert.equal(item.options.body, "Plan s3");
  item.onclick();
  assert.deepEqual([...a.opened, ...b.opened], ["/s/s3/"]);
  await a.alerts.update([s1, s3]);
  assert.equal(a.sent.length + b.sent.length, 1);
  const reload = alertFixture({
    storage,
    locks,
    permission: "granted",
    sessionId: "s2",
  });
  await reload.alerts.update([s1, s3]);
  assert.equal(reload.sent.length, 0);
  const plan = a.entry("s4", "3", { offer: "plan", publishedAt: later() });
  await b.alerts.update([plan]);
  assert.equal(b.sent.at(-1).title, "Round 3 is ready to accept");
});

test("granted permission enables automatically unless explicitly disabled; re-enabling skips backlog", async () => {
  const storage = new Map();
  const a = alertFixture({ storage, permission: "granted" });
  await a.alerts.update([a.entry("s2", "1")]);
  assert.equal(a.button.textContent, "Disable notifications");
  assert.equal(a.requests(), 0);
  assert.equal(a.sent.length, 0);
  await a.alerts.update([a.entry("s2", "2", { publishedAt: later() })]);
  assert.equal(a.sent.length, 1);
  await a.button.onclick();
  const b = alertFixture({ storage, permission: "granted" });
  const backlog = b.entry("s2", "3", { publishedAt: later() });
  await b.alerts.update([backlog]);
  assert.equal(b.button.textContent, "Enable notifications");
  assert.equal(b.sent.length, 0);
  await b.button.onclick();
  await b.alerts.update([backlog]);
  assert.equal(b.sent.length, 0);
  await b.alerts.update([
    b.entry("s2", "4", { publishedAt: "2000-01-01T00:00:00Z" }),
  ]);
  assert.equal(b.sent.length, 0);
  await b.alerts.update([
    b.entry("s2", "5", { publishedAt: "2099-01-01T00:00:00Z" }),
  ]);
  assert.equal(b.sent.length, 1);
});

test("only sessions that need the user alert, and an offered round says so", () => {
  const entry = {
    id: "s1",
    title: "Plan",
    offer: "plan",
    round: "3",
    stage: "updated",
    needsYou: true,
    url: "/s/s1/",
    publishedAt: "2026-01-01T00:00:00Z",
  };
  assert.deepEqual(reviewAlert(entry), {
    id: "round:s1:3",
    sessionId: "s1",
    title: "Round 3 is ready to accept",
    body: "Plan",
    url: "/s/s1/",
    createdAt: "2026-01-01T00:00:00Z",
  });
  assert.equal(reviewAlert({ ...entry, needsYou: false }), null);
  assert.equal(reviewAlert({ ...entry, id: "" }), null);
  assert.equal(reviewAlert(null), null);
});

test("denied, unavailable, and failed notifications disable the control", async () => {
  for (const options of [{ permission: "denied" }, { supported: false }]) {
    const a = alertFixture(options);
    await a.alerts.update([a.entry("s2", "1")]);
    assert.equal(a.button.disabled, true);
    assert.equal(a.sent.length, 0);
  }
  const a = alertFixture({ blockedStorage: true });
  await a.button.onclick();
  const entry = a.entry("s2", "1", { publishedAt: later() });
  await a.alerts.update([entry]);
  await a.alerts.update([entry]);
  assert.equal(a.sent.length, 1);
  a.sent[0].onerror();
  assert.equal(a.button.disabled, true);
  assert.match(a.button.title, /delivery failed/);
});

test("each reply and pull request in another session alerts once and opens where it happened, and a page does not alert", async () => {
  const a = alertFixture({ permission: "granted" });
  await a.alerts.update([]);
  const at = later();
  const entry = a.entry("s2", "2", {
    needsYou: false,
    events: [
      {
        id: "e1",
        kind: "reply",
        name: "Overview",
        round: "2",
        page: "overview",
        target: "failure",
        thread: "t1",
        at,
      },
      {
        id: "e2",
        kind: "side-work",
        name: "Delete visual-review",
        url: "https://github.com/RyanSaxe/pair/pull/12",
        page: "agreed",
        target: "side-work-1",
        at,
      },
      {
        id: "e3",
        kind: "page",
        name: "Offers",
        round: "1",
        page: "offers",
        at,
      },
    ],
  });
  await a.alerts.update([entry]);
  await a.alerts.update([entry]);
  assert.deepEqual(
    a.sent.map((item) => [item.title, item.options.body]),
    [
      ["Agent replied on Overview", "Plan s2"],
      ["Side work opened pull request #12", "Plan s2"],
    ],
  );
  for (const item of a.sent) item.onclick();
  // A reply opens at its thread's card, not at the block the thread is on.
  assert.deepEqual(a.opened, [
    "/s/s2/?target=thread-t1#overview",
    "/s/s2/?target=side-work-1#agreed",
  ]);
  // The page that completes a round waiting for the reviewer is announced
  // by the round's alert alone, before and after the reviewer submits.
  const complete = a.entry("s3", "4", {
    publishedAt: later(),
    events: [
      { id: "e4", kind: "page", name: "Summary", round: "4", page: "summary" },
    ].map((event) => ({ ...event, at: later() })),
  });
  await a.alerts.update([complete]);
  await a.alerts.update([{ ...complete, needsYou: false }]);
  assert.deepEqual(
    a.sent.slice(2).map((item) => item.title),
    ["Round 4 is ready"],
  );
});

test("a session whose agent the hub could not wake alerts once per round", async () => {
  const a = alertFixture({ permission: "granted" });
  await a.alerts.update([]);
  const failed = a.entry("s2", "3", { needsYou: false, wakeFailed: true });
  assert.deepEqual(wakeAlert(failed), {
    id: "wake:s2:3",
    sessionId: "s2",
    title: "Could not wake the agent",
    body: "Plan s2",
    url: "/s/s2/",
  });
  assert.equal(wakeAlert({ ...failed, wakeFailed: false }), null);
  await a.alerts.update([failed]);
  await a.alerts.update([failed]);
  await a.alerts.update([{ ...failed, round: "4" }]);
  assert.deepEqual(
    a.sent.map((item) => item.title),
    ["Could not wake the agent", "Could not wake the agent"],
  );
});
