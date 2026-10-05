import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { hub, literal, pairCli, planData } from "../support/hub.mjs";

const card = (id, title) => ({
  id,
  title,
  delivers: `${title}, delivered.`,
  recommend: "sub-session",
});
const status = async (directory) =>
  JSON.parse(await fs.readFile(path.join(directory, "status.json"), "utf8"));
const proposal = async (directory, id) =>
  JSON.parse(
    await fs.readFile(path.join(directory, "proposals", `${id}.json`), "utf8"),
  );

// A parent session with round 1 published and three cards: deck, which the
// reviewer started in a sub-session after the agent joined outline into
// it, and notes, which nobody started. The CLI runs as a separate agent.
async function parent(t) {
  const h = await hub(t);
  const home = path.join(h.home, "cli");
  await fs.mkdir(home);
  const cli = await pairCli(home, {
    XDG_STATE_HOME: h.home,
    PAIR_HUB_PORT: "0",
  });
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  for (const [id, title] of [
    ["deck", "Build the deck"],
    ["notes", "Write the speaker notes"],
    ["outline", "Outline the talk"],
  ])
    assert.equal((await a.action("propose", card(id, title))).code, 200);
  const joined = await a.action("propose", { id: "outline", join: "deck" });
  assert.equal(joined.code, 200, joined.body.error);
  const started = await a.request(`${a.base}/api/proposals/deck/start`, {
    where: "sub-session",
    message: "Keep the header height.",
  });
  assert.equal(started.code, 200, started.body.error);
  const from = (...args) => cli.run("start", "--from", a.directory, ...args);
  return { h, a, cli, from };
}

test("pair start --from creates a session for a started proposal, linked both ways, and prints the cards joined into it", async (t) => {
  const { h, a, cli, from } = await parent(t);
  const output = await from("--proposal", "deck");
  const child = (await fs.readdir(h.config.sessions))
    .map((name) => path.join(h.config.sessions, name))
    .find((directory) => directory !== a.directory);
  const linked = await status(child);
  assert.deepEqual(linked.parent, {
    sessionId: a.id,
    sessionDir: a.directory,
    proposal: "deck",
  });
  assert.equal(linked.title, "Build the deck");
  assert.deepEqual((await proposal(a.directory, "deck")).started.session, {
    id: linked.sessionId,
    dir: child,
    url: `/s/${linked.sessionId}/`,
  });
  // The output names both sessions and prints the card with the cards
  // joined into it and the reviewer's message, for the agent that runs the
  // new session.
  for (const line of [
    `Session   ${child}`,
    `Parent    ${a.directory}`,
    "Proposal  deck",
    'The reviewer approved proposal deck, "Build the deck", to run in a sub-session.',
    [
      "Delivers: Build the deck, delivered.",
      "Proposals joined into deck, whose work is part of deck:",
      "  outline  Outline the talk",
      "           Delivers: Outline the talk, delivered.",
    ].join("\n"),
    "Keep the header height.",
  ])
    assert.ok(output.includes(line), `${line} in:\n${output}`);
  assert.doesNotMatch(output, /May change/);
  // The new session's holder is this agent, and pair status names the
  // parent in the new session and the link in the parent.
  const own = await cli.run("status", "--session-dir", child);
  assert.match(own, /^Next: Publish Agreed with round 1's page list/);
  assert.match(
    own,
    new RegExp(`Parent +${literal(a.directory)}, proposal deck`),
  );
  const theirs = await cli.run("status", "--session-dir", a.directory);
  assert.match(
    theirs,
    new RegExp(`Linked sessions +deck in ${literal(child)}`),
  );
});

test("pair start --from refuses a missing --proposal, a directory with no session, an unknown proposal, and one already linked, and creates nothing", async (t) => {
  const { h, a, from, cli } = await parent(t);
  const sessions = () => fs.readdir(h.config.sessions);
  const before = await sessions();
  const refuses = async (run, pattern) => {
    await assert.rejects(run, (error) => {
      assert.match(error.stderr, pattern);
      return true;
    });
    assert.deepEqual(await sessions(), before);
  };
  await refuses(from(), /--from takes --proposal ID/);
  await refuses(
    cli.run(
      "start",
      ...["--from", path.join(h.home, "elsewhere"), "--proposal", "deck"],
    ),
    /No pair session at .*elsewhere/,
  );
  await refuses(from("--proposal", "slides"), /No proposal slides/);
  // A card the reviewer has not started is not an instruction to run it.
  await refuses(from("--proposal", "notes"), /has not approved proposal notes/);
  await from("--proposal", "deck");
  const linked = (await sessions()).length;
  await assert.rejects(from("--proposal", "deck"), /already linked to session/);
  assert.equal((await sessions()).length, linked);
  // The first link stands.
  assert.equal(
    (await proposal(a.directory, "deck")).started.session.dir,
    path.join(
      h.config.sessions,
      (await sessions()).find((name) => !before.includes(name)),
    ),
  );
});
