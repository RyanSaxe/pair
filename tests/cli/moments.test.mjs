import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildPage } from "../../src/cli/build.mjs";
import { guideText } from "../../src/shared/guide.mjs";
import { offers } from "../../src/shared/offers.mjs";
import { hub, pairCli, root, task } from "../support/hub.mjs";

// Each moment's text as a command prints it, with its links as commands.
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
  // The reviewer sends a submission from the browser.
  async function submit(...event) {
    const sent = await session.feedback(session.event(...event));
    assert.equal(sent.code, 200, sent.body.error);
  }
  return { cli, session, printed, publish, read, submit };
}

// A command's output is the next step, then its moment's text, then its
// data, and it contains no other moment's text.
function printsMoment(output, name, printed) {
  const [next, ...rest] = output.split("\n\n");
  assert.match(next, /^Next: /, output);
  assert.ok(
    `${rest.join("\n\n")}\n`.startsWith(`${printed.get(name)}\n`),
    `${name} after the next step in:\n${output}`,
  );
  for (const [other, text] of printed)
    if (other !== name)
      assert.ok(!output.includes(text), `${other} in:\n${output}`);
  return next;
}

// The line that says to publish Agreed says when it names each offer.
function namesOffers(next, names) {
  for (const part of names)
    assert.ok(next.includes(part), `${part} in ${next}`);
}

test("each command prints the moment it is run at", async (t) => {
  const { cli, session, printed, publish, read, submit } = await holder(t);
  const started = await cli.run("start", "--title", "Moments");
  namesOffers(printsMoment(started, "start", printed), [
    '"offer": "plan"',
    "overview first",
    '"offer": "finish"',
  ]);

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
      ['"offer": "plan"', "overview first", '"offer": "finish"'],
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
      ['"offer": "finish"'],
    ],
    [
      "publish-agreed-finish",
      () => publish("3", "agreed", { offer: "finish", pages: ["step"] }),
    ],
  ];
  for (const [name, run, offerNames] of rows) {
    const next = printsMoment(await run(), name, printed);
    if (offerNames) namesOffers(next, offerNames);
  }
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
