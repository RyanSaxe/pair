import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { PairWake } from "../../adapters/opencode/plugin.js";
import { findAgent } from "../../src/cli/agents.mjs";
import { agentsScratch, outsideAgents } from "../support/agents.mjs";
import { alive, exec, inbox, pair, waitUntil } from "../support/hub.mjs";

// A receiving Claude Code session, with an inbox that records each message,
// and senders inside a stand-in agent CLI or outside any agent CLI.
async function scratch(t) {
  const scratch = await agentsScratch(t);
  const receiver = await inbox(t, scratch.home);
  const web = await scratch.agent(await scratch.folder("web"), {
    env: {
      CLAUDE_CODE_SESSION_ID: "receiver",
      CLAUDE_CODE_MESSAGING_SOCKET: receiver.socket,
      CLAUDE_CODE_MESSAGING_TOKEN: receiver.token,
    },
  });
  const { name } = JSON.parse((await web.run(["register", "--json"])).stdout);
  const received = () =>
    receiver.wakes.map(({ auth, message }) => {
      assert.equal(auth.token, receiver.token);
      return message.message.content;
    });
  return { ...scratch, web, name, received };
}

const answers = (to) =>
  `To answer, run: pair message --to ${to} --text "…"\nIf you have nothing to say, acknowledge it: pair message --to ${to} --ack`;
const noAnswer =
  "This message has no answer command. Answer in your own chat, if at all.";

test("a message from an agent session names it and ends with the commands to answer and acknowledge it, and a session that exited gets none", async (t) => {
  const { web, name, folder, agent, received } = await scratch(t);
  const api = await agent(await folder("api"), {
    env: { CLAUDE_CODE_SESSION_ID: "sender" },
  });
  const message = (...args) => api.run(["message", "--to", name, ...args]);
  const sent = await message("--text", "Use revoked_at.");
  assert.equal(sent.status, 0, sent.stderr);
  assert.equal((await message("--ack")).status, 0);
  // pair message registered the sender, which keeps its name when it
  // registers again.
  const sender = JSON.parse((await api.run(["register", "--json"])).stdout);
  const from = `${sender.name} (Claude Code in ${path.join("~", "api")})`;
  assert.deepEqual(received(), [
    `pair message from ${from}:\n\nUse revoked_at.\n\n${answers("claude-code:sender")}`,
    `pair message from ${from} acknowledges your message. Don't answer it.`,
  ]);

  await web.kill();
  assert.equal((await message("--text", "Here?")).status, 1);
  assert.equal(received().length, 2);
});

// pair counts a sender as the user only when no agent CLI is among its parent
// processes, and the test itself may run inside one. orphan therefore starts
// pair message from a node process that exits at once, so the system adopts
// the command before pair reads its parent processes. orphan waits for the
// command to exit.
async function orphan(home, args, env) {
  const start = `const child = require("node:child_process").spawn(process.execPath, ${JSON.stringify([pair, "message", ...args])}, { detached: true, windowsHide: true, stdio: "ignore" });
process.stdout.write(String(child.pid));
child.unref();`;
  const { stdout } = await exec(process.execPath, ["-e", start], { env });
  assert.ok(await waitUntil(() => !alive(Number(stdout)), 30_000));
}

test("a message from outside any agent CLI is from your user, and --ack sends nothing there", async (t) => {
  const { home, env, name, received } = await scratch(t);
  const plain = { ...outsideAgents, ...env };
  await orphan(home, ["--to", name, "--text", "Stop here."], plain);
  assert.deepEqual(received(), [
    `pair message from your user:\n\nStop here.\n\n${noAnswer}`,
  ]);
  await orphan(home, ["--to", name, "--ack"], plain);
  assert.equal(received().length, 1);
});

test("--from names the sender with no command to answer, NAME/SUBAGENT asks the parent to pass the message on, and PAIR_WAKE=off sends nothing", async (t) => {
  const { name, outside, received } = await scratch(t);
  const from = ["--from", "nightly-ci", "--text", "The nightly build failed."];
  const labelled = await outside(["message", "--to", name, ...from]);
  assert.equal(labelled.code, undefined, labelled.stderr);
  const off = await outside(["message", "--to", `${name}/reviewer`, ...from], {
    PAIR_WAKE: "off",
  });
  assert.equal(off.code, undefined, off.stderr);
  assert.deepEqual(received(), [
    `pair message from nightly-ci:\n\nThe nightly build failed.\n\n${noAnswer}`,
  ]);
  assert.match(
    off.stderr,
    /^wake off, not sent: pair message from nightly-ci, for your subagent reviewer\. .* with SendMessage,/,
  );
});

test("a message over 100 KB is refused and sends nothing", async (t) => {
  const { home, name, outside, received } = await scratch(t);
  const file = path.join(home, "long.txt");
  await fs.writeFile(file, "a".repeat(100_001));
  const refused = await outside([
    "message",
    "--to",
    name,
    "--from",
    "ci",
    "--file",
    file,
  ]);
  assert.equal(refused.code, 1);
  assert.deepEqual(received(), []);
});

// opencode gives a subagent's commands the subagent's own session ID, and
// pair's plugin, which this process runs as opencode does, answers with the
// session's parent and title. A task has spaces, so the answer is quoted. A
// Codex subagent takes the same path, with its parent from Codex's daemon.
test("an opencode subagent's register refuses, and its message names it through its parent by its task", async (t) => {
  const { name, folder, agent, received } = await scratch(t);
  const sessions = {
    ses_root: { title: "Fix the login" },
    ses_child: {
      parentID: "ses_root",
      title: "Find the tests (@explore subagent)",
    },
  };
  const client = {
    session: { get: async ({ path: { id } }) => ({ data: sessions[id] }) },
  };
  const plugin = await PairWake({ client });
  t.after(() => plugin.dispose());
  const env = {};
  await plugin["shell.env"]({}, { env });
  const opencode = await agent(await folder("api"), {
    harness: "opencode",
    env,
  });
  const as = (session) => ({ env: { PAIR_OPENCODE_SESSION: session } });
  const registered = await opencode.run(["register", "--json"], as("ses_root"));
  const { name: api } = JSON.parse(registered.stdout);
  const refused = await opencode.run(["register"], as("ses_child"));
  assert.equal(refused.status, 1);
  assert.ok(refused.stderr.includes(`${api}/Find the tests`), refused.stderr);
  const sent = await opencode.run(
    ["message", "--to", name, "--text", "Done."],
    as("ses_child"),
  );
  assert.equal(sent.status, 0, sent.stderr);
  assert.deepEqual(received(), [
    `pair message from ${api}/Find the tests (opencode in ${path.join("~", "api")}):\n\nDone.\n\n${answers('"opencode:ses_root/Find the tests"')}`,
  ]);
});

test("--to finds a session by name, by ID, or by the start of one ID", () => {
  const api = { id: "codex:0199c1d4-1111", name: "api-d3" };
  const web = { id: "codex:0199c1d4-2222", name: "web-11" };
  const entries = [api, web];
  assert.equal(findAgent(entries, "web-11"), web);
  assert.equal(findAgent(entries, "codex:0199c1d4-1111"), api);
  assert.equal(findAgent(entries, "codex:0199c1d4-2"), web);
  assert.equal(findAgent(entries, "shop-ea"), null);
  assert.throws(() => findAgent(entries, "codex:0199c1d4"));
});
