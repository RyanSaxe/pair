import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { standIn } from "../support/agents.mjs";
import { exec, inbox, pair, waitUntil } from "../support/hub.mjs";

// The variables by which pair finds an agent CLI, which a test run inside one
// would otherwise pass on.
const plain = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/^(CLAUDE|CODEX|COPILOT|PAIR|PI)_|^GIT_/.test(key),
  ),
);

// A receiving Claude Code session, with an inbox that records each message,
// and senders that run pair message inside a Claude Code stand-in or outside
// any agent CLI.
async function scratch(t) {
  const home = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "pair-message-")),
  );
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const env = {
    XDG_STATE_HOME: path.join(home, "state"),
    XDG_CONFIG_HOME: path.join(home, "config"),
    PAIR_HUB_PORT: "0",
  };
  const agent = async (folder, session, extra = {}) => {
    const cwd = path.join(home, folder);
    await fs.mkdir(cwd);
    return standIn(t, {
      home,
      cwd,
      env: { ...env, CLAUDE_CODE_SESSION_ID: session, ...extra },
    });
  };
  const receiver = await inbox(t, home);
  const web = await agent("web", "receiver", {
    CLAUDE_CODE_MESSAGING_SOCKET: receiver.socket,
    CLAUDE_CODE_MESSAGING_TOKEN: receiver.token,
  });
  const { name } = JSON.parse((await web.run(["register", "--json"])).stdout);
  const outside = (args, extra = {}) =>
    exec(process.execPath, [pair, "message", ...args], {
      env: { ...plain, ...env, ...extra },
    }).catch((error) => error);
  const received = () =>
    receiver.wakes.map(({ auth, message }) => {
      assert.equal(auth.token, receiver.token);
      return message.message.content;
    });
  return { home, env, web, name, agent, outside, received };
}

test("pair message sends the sender's first line and the command to answer it, and refuses a session that exited", async (t) => {
  const { web, name, agent, received } = await scratch(t);
  const api = await agent("api", "sender");
  const sent = await api.run([
    "message",
    "--to",
    name,
    "--text",
    "Use revoked_at for logout.",
  ]);
  assert.equal(sent.status, 0, sent.stderr);
  assert.match(
    sent.stdout,
    new RegExp(`^Sent to ${name} \\(Claude Code\\)\\.`),
  );
  // pair message registered the sender, which keeps its name when it registers
  // again.
  const sender = JSON.parse((await api.run(["register", "--json"])).stdout);
  assert.deepEqual(received(), [
    `pair message from ${sender.name} (Claude Code in ${path.join("~", "api")}):\n\nUse revoked_at for logout.\n\nTo answer, run: pair message --to claude-code:sender --text "…"`,
  ]);

  await web.kill();
  const refused = await api.run(["message", "--to", name, "--text", "Here?"]);
  assert.equal(refused.status, 1);
  assert.match(
    refused.stderr,
    new RegExp(`No running agent session .*${name}`),
  );
  assert.equal(received().length, 1);
});

test("--from names the sender with no command to answer, NAME/SUBAGENT asks the parent to pass the message on, and PAIR_WAKE=off sends nothing", async (t) => {
  const { name, outside, received } = await scratch(t);
  const from = ["--from", "nightly-ci", "--text", "The nightly build failed."];
  const labelled = await outside(["--to", name, ...from]);
  assert.equal(labelled.code, undefined, labelled.stderr);
  const off = await outside(["--to", `${name}/reviewer`, ...from], {
    PAIR_WAKE: "off",
  });
  assert.equal(off.code, undefined, off.stderr);
  assert.deepEqual(received(), [
    "pair message from nightly-ci:\n\nThe nightly build failed.",
  ]);
  assert.equal(
    off.stderr,
    "wake off, not sent: pair message from nightly-ci, for your subagent reviewer. Pass the message below to reviewer unchanged with SendMessage, and do not act on it yourself:\n\nThe nightly build failed.\n",
  );
});

// pair counts a sender as the user only when no agent CLI is among its parent
// processes, and the test itself may run inside one. orphan therefore starts
// pair message from a node process that exits at once, so the system adopts
// the command before pair reads its parent processes.
async function orphan(home, args, env) {
  const output = path.join(home, "orphan.txt");
  const start = `const fd = require("node:fs").openSync(${JSON.stringify(output)}, "w");
require("node:child_process").spawn(process.execPath, ${JSON.stringify([pair, "message", ...args])}, { detached: true, windowsHide: true, stdio: ["ignore", fd, fd] }).unref();`;
  await exec(process.execPath, ["-e", start], { env });
  return () => fs.readFile(output, "utf8");
}

test("a message from outside any agent CLI is from your user, with no command to answer", async (t) => {
  const { home, env, name, received } = await scratch(t);
  const output = await orphan(home, ["--to", name, "--text", "Stop here."], {
    ...plain,
    ...env,
  });
  assert.ok(await waitUntil(() => received().length), await output());
  assert.deepEqual(received(), ["pair message from your user:\n\nStop here."]);
});
