import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildPage } from "../../src/cli/build.mjs";
import { guideText } from "../../src/shared/guide.mjs";
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
  async function publish(round, page, { pages, plan } = {}) {
    const file = path.join(home, `page-${++count}.html`);
    const html = await buildPage(path.join(home, "source.json"), {
      name: "example",
      round,
      title: "Moments",
      ...(plan ? { plan } : {}),
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
      ...["--recommend", "here"],
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
  return {
    cli,
    session,
    printed,
    publish,
    read,
    submit,
    propose,
    reviewer,
  };
}

// A command's output contains its moments' text and no other moment's.
function printsMoment(output, names, printed) {
  const named = [names].flat();
  for (const name of named)
    assert.ok(output.includes(printed.get(name)), `${name} in:\n${output}`);
  for (const [other, text] of printed)
    if (!named.includes(other))
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
      "read-start-sub-session",
      async () => {
        await propose("apart");
        await reviewer("apart", "start", { where: "sub-session" });
        return read();
      },
    ],
    // The holder's own start prints in pair propose, not in pair read.
    ...["here", "sub-session"].map((where) => [
      `read-start-${where}`,
      async () => {
        await propose(`asked-${where}`);
        return cli.run(
          ...["propose", "--session-dir", session.directory],
          ...["--id", `asked-${where}`, "--start", where],
          ...["--quote", "Do this too."],
        );
      },
    ]),
    [
      ["start", "start-from"],
      () =>
        cli.run(
          "start",
          ...["--from", session.directory, "--proposal", "apart"],
        ),
    ],
    [
      "read-closed",
      async () => {
        const { proposals } = (await session.status()).body;
        const linked = proposals.find((card) => card.id === "apart");
        await session.request(`${linked.started.session.url}api/dismiss`, {});
        return read();
      },
    ],
    [
      "read-open-agent",
      async () => {
        await propose("agent");
        await reviewer("agent", "open-agent");
        const { threads } = (await session.status()).body;
        const thread = threads.find((item) => item.kind === "open-agent");
        return read("--thread", thread.id);
      },
    ],
  ];
  for (const [name, run] of rows) printsMoment(await run(), name, printed);
});

// Keep iterating asks for nothing new, so only the other choices name a
// moment, and iterate names one only on a plan round.
test("pair read prints the moment for the reviewer's choice of the next round", async (t) => {
  const { cli, printed, publish, read, submit } = await holder(t);
  await cli.run("start", "--title", "Choices");
  const rows = [
    ["iterate", false, "read-feedback"],
    ["plan", false, ["read-feedback", "read-plan"]],
    ["plan", true, ["read-feedback", "read-plan"]],
    ["iterate", true, ["read-feedback", "read-iterate"]],
    ["build", false, ["read-feedback", "read-build"]],
  ];
  for (const [index, [next, plan, moments]] of rows.entries()) {
    const round = String(index + 1);
    await publish(round, "agreed", { pages: ["one"], plan });
    await publish(round, "one");
    await submit("feedback-only", round, { next });
    printsMoment(await read(), moments, printed);
  }
});
