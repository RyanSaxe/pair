import assert from "node:assert/strict";
import crypto from "node:crypto";
import { hub, planData } from "./hub.mjs";

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

export const navigationRound = (number, title, name = "example") => ({
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

export const kinds = {
  page: { topic: "overview", anchor: "Result line", target: "result" },
  guide: { topic: "guide", anchor: "Result line", target: "result" },
  progress: { topic: "agreed", anchor: "Progress", target: "agent-activity" },
};

export async function sessionTools(h, session) {
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

export async function setup(t) {
  const h = await hub(t);
  return sessionTools(h, await h.session());
}

export const focused = (page, id) =>
  page.waitForFunction(
    (row) => document.activeElement?.id === row,
    `thread-${id}-1`,
    { timeout: 5000 },
  );
export const selected = (page, tab) =>
  page.locator(`#${tab}-tab[aria-selected="true"]`).waitFor({ timeout: 5000 });
export const cards = (page, id) =>
  page.locator(`pair-thread[data-thread="${id}"]`).count();
export const title = (page, text) =>
  page.locator("#page-title", { hasText: text }).waitFor({ timeout: 5000 });
// The bell marks every event it finds on its first load as seen, so each
// test waits for the bell to show before the agent replies.
export const bellReady = (page) => page.locator("#bell").waitFor();
export async function bell(page) {
  await page.locator("#bell").click();
  await page.locator("#center-list .session-row").click();
}
