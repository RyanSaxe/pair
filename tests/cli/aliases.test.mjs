import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildPage } from "../../src/cli/build.mjs";
import {
  exec,
  exists,
  hub,
  literal,
  pair,
  pairCli,
  task,
} from "../support/hub.mjs";

// An agent that read the previous guide keeps running its commands for this
// release. Each removed form does its old job and names its replacement on
// stderr, which keeps --json output parseable.
test("every removed command and flag still runs and prints its replacement", async (t) => {
  const h = await hub(t);
  const home = path.join(h.home, "cli");
  await fs.mkdir(home);
  const cli = await pairCli(home, {
    XDG_STATE_HOME: h.home,
    PAIR_HUB_PORT: "0",
  });
  const a = await h.session({ cli });
  const dir = ["--session-dir", a.directory];
  const replaced = async (args, replacement) => {
    const { stdout, stderr } = await cli.output(...args);
    assert(stderr.includes(replacement), `${args.join(" ")}: ${stderr}`);
    return stdout;
  };
  const status = async () => (await a.status()).body;

  await replaced(["ack", ...dir, "--note", "Reading"], "pair progress --note");
  assert.equal((await status()).report.note, "Reading");

  const page = (id, extra) =>
    buildPage(path.join(home, "source.json"), {
      name: "example",
      round: "1",
      title: "Example work",
      page: { id, title: id, ...extra },
    });
  const pages = ["overview", "detail"].map((id) => ({ id, title: id }));
  await a.action("publish", {
    html: await page("agreed", { agreements: [], task }),
    pages,
  });
  await replaced(["progress", ...dir, "--start", "overview|detail"], "--page");
  assert.deepEqual(
    (await status()).openRound.pages.map((slot) => slot.state),
    ["active", "active"],
  );

  const started = await a.request(`${a.base}/api/threads`, {
    id: "question",
    round: "1",
    topic: "agreed",
    anchor: "Progress",
    text: "Why two pages?",
  });
  assert.equal(started.code, 201, started.body.error);
  const thread = await replaced(
    ["reply", ...dir, "--note", "question"],
    "pair read --thread ID",
  );
  assert.match(thread, /\n<pair_thread id="question" /);
  assert.equal((await status()).threads[0].state, "read");

  for (const { id } of pages)
    await a.action("publish", { html: await page(id, { html: "<p>x</p>" }) });
  const event = a.event();
  assert.equal((await a.feedback(event)).code, 200);
  await cli.run("read", ...dir);
  const again = await replaced(
    ["read", ...dir, "--id", event.id],
    "--submission",
  );
  assert.match(again, new RegExp(`<pair_feedback submission="${event.id}"`));

  const env = { ...process.env, XDG_STATE_HOME: h.home, PAIR_HUB_PORT: "0" };
  const codexHome = path.join(h.home, "codex");
  const rules = await exec(process.execPath, [pair, "check", "--codex-rules"], {
    env: { ...env, CODEX_HOME: codexHome },
  });
  assert(rules.stderr.includes("pair setup-codex"), rules.stderr);
  assert(await exists(path.join(codexHome, "rules", "pair.rules")));
  const state = path.join(h.home, "other-state");
  const checked = await exec(process.execPath, [pair, "check", state], {
    env,
  });
  assert(checked.stderr.includes("XDG_STATE_HOME"), checked.stderr);
  assert.match(
    checked.stdout,
    new RegExp(`\nstorage +${literal(state)}, writable\n`),
  );
  assert(await exists(state));
});
