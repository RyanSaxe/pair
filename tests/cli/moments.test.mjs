import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildPage } from "../../src/cli/build.mjs";
import { guideText } from "../../src/shared/guide.mjs";
import { offers } from "../../src/shared/offers.mjs";
import { hub, pairCli, root, task } from "../support/hub.mjs";

// Each moment's text as a command prints it.
const printed = new Map();
for (const file of await fs.readdir(path.join(root, "guide/moments")))
  printed.set(
    path.basename(file, ".md"),
    (await guideText(`moments/${file}`)).trim(),
  );

// The CLI as the holder of a session on an in-process hub. publish builds a
// page and publishes it with pair publish, as an agent does.
async function holder(t) {
  const h = await hub(t);
  const home = path.join(h.home, "cli");
  await fs.mkdir(home);
  const cli = await pairCli(home, {
    XDG_STATE_HOME: h.home,
    PAIR_HUB_PORT: "0",
  });
  const session = await h.session({ cli });
  const dir = ["--session-dir", session.directory];
  let count = 0;
  async function publish(round, page, { offer, pages } = {}) {
    const file = path.join(home, `page-${++count}.html`);
    const html = await buildPage(path.join(home, "source.json"), {
      name: "example",
      round,
      ...(offer ? { offer } : {}),
      title: "Moments",
      page:
        page === "agreed"
          ? { id: "agreed", title: "Agreed so far", agreements: [], task }
          : { id: page, title: page, html: "<p>A page.</p>" },
    });
    await fs.writeFile(file, html);
    const list = path.join(home, `pages-${count}.json`);
    if (pages)
      await fs.writeFile(
        list,
        JSON.stringify({ pages: pages.map((id) => ({ id, title: id })) }),
      );
    return cli.run(
      "publish",
      ...dir,
      "--file",
      file,
      ...(pages ? ["--pages", list] : []),
    );
  }
  const read = (...args) => cli.run("read", ...dir, ...args);
  // A proposal the agent records, and the reviewer's Start or Decline on it.
  const propose = (id) =>
    cli.run(
      "propose",
      ...dir,
      ...["--id", id, "--title", id, "--delivers", "A fix."],
      ...["--changes", "One file.", "--recommend", "here"],
      ...["--reason", "It is small.", "--source", "From the conversation"],
    );
  async function reviewer(id, action, body = {}) {
    const sent = await session.request(
      `${session.base}/api/proposals/${id}/${action}`,
      body,
    );
    assert.equal(sent.code, 200, sent.body.error);
  }
  // The reviewer sends a submission from the browser.
  async function submit(...event) {
    const sent = await session.feedback(session.event(...event));
    assert.equal(sent.code, 200, sent.body.error);
  }
  return { cli, session, printed, publish, read, submit, propose, reviewer };
}

// A command's output contains its moment's text and no other moment's.
function printsMoment(output, name, printed) {
  assert.ok(output.includes(printed.get(name)), `${name} in:\n${output}`);
  for (const [other, text] of printed)
    if (other !== name)
      assert.ok(!output.includes(text), `${other} in:\n${output}`);
}

test("each command prints the moment it is run at", async (t) => {
  const { cli, session, printed, publish, read, submit, propose, reviewer } =
    await holder(t);
  printsMoment(await cli.run("start", "--title", "Moments"), "start", printed);

  const rows = [
    ["publish-agreed", () => publish("1", "agreed", { pages: ["one", "two"] })],
    ["publish-page", () => publish("1", "one")],
    ["publish-last-page", () => publish("1", "two")],
    [
      "read-feedback",
      async () => {
        await submit("feedback-only", "1");
        return read();
      },
    ],
    [
      "read-thread",
      async () => {
        await session.request(`${session.base}/api/threads`, {
          id: "question",
          round: "1",
          topic: "one",
          anchor: "A page",
          text: "Why?",
        });
        return read("--thread", "question");
      },
    ],
    [
      "read-declined",
      async () => {
        await propose("later");
        await reviewer("later", "decline");
        return read();
      },
    ],
    [
      "read-start-here",
      async () => {
        await propose("now");
        await reviewer("now", "start", { where: "here" });
        return read();
      },
    ],
    [
      "publish-agreed-plan",
      () => publish("2", "agreed", { offer: "plan", pages: ["overview"] }),
    ],
    [
      "read-accept-implement",
      async () => {
        await publish("2", "overview");
        await submit("accept", "2", { offer: "plan", action: "implement" });
        return read();
      },
    ],
    [
      "publish-agreed-finish",
      () => publish("3", "agreed", { offer: "finish", pages: ["step"] }),
    ],
  ];
  for (const [name, run] of rows) printsMoment(await run(), name, printed);
});

// The hub names an acceptance's moment by the action the reviewer chose.
test("pair read prints the moment of each acceptance's action", async (t) => {
  for (const [offer, { accept }] of Object.entries(offers))
    for (const action of accept.actions) {
      const { printed, publish, read, submit } = await holder(t);
      const first = offers[offer].firstPage || "work";
      await publish("1", "agreed", { offer, pages: [first] });
      await publish("1", first);
      await submit("accept", "1", { offer, action: action.id });
      printsMoment(await read(), `read-accept-${action.id}`, printed);
    }
});
