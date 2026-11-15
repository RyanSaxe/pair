import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PairWake } from "../../adapters/opencode/plugin.js";
import { findAgent } from "../../src/cli/agents.mjs";
import { outsideAgents, standIn } from "../support/agents.mjs";
import { codexDaemon } from "../support/codex.mjs";
import { alive, exec, inbox, pair, waitUntil } from "../support/hub.mjs";

// A receiving Claude Code session, with an inbox that records each message,
// and senders that run pair message inside a stand-in agent CLI or outside
// any agent CLI.
async function scratch(t) {
  const home = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "pair-message-")),
  );
  const started = [];
  // Windows refuses to remove the working directory or the executable of a
  // running process, so the stand-ins stop before the test's directory goes,
  // and rm retries while Windows releases them.
  t.after(async () => {
    for (const agent of started) await agent.kill();
    await fs.rm(home, { recursive: true, force: true, maxRetries: 5 });
  });
  const env = { XDG_STATE_HOME: path.join(home, "state"), PAIR_HUB_PORT: "0" };
  const agent = async (folder, extra, harness) => {
    const cwd = path.join(home, folder);
    await fs.mkdir(cwd, { recursive: true });
    const cli = await standIn(t, {
      home,
      cwd,
      harness,
      env: { ...env, ...extra },
    });
    started.push(cli);
    return cli;
  };
  const receiver = await inbox(t, home);
  const web = await agent("web", {
    CLAUDE_CODE_SESSION_ID: "receiver",
    CLAUDE_CODE_MESSAGING_SOCKET: receiver.socket,
    CLAUDE_CODE_MESSAGING_TOKEN: receiver.token,
  });
  const { name } = JSON.parse((await web.run(["register", "--json"])).stdout);
  const outside = (args, extra = {}) =>
    exec(process.execPath, [pair, "message", ...args], {
      env: { ...outsideAgents, ...env, ...extra },
    }).catch((error) => error);
  const received = () =>
    receiver.wakes.map(({ auth, message }) => {
      assert.equal(auth.token, receiver.token);
      return message.message.content;
    });
  return { home, env, web, name, agent, outside, received };
}

const answers = (to) =>
  `To answer, run: pair message --to ${to} --text "…"\nIf you have nothing to say, acknowledge it: pair message --to ${to} --ack`;
const noAnswer =
  "This message has no answer command. Answer in your own chat, if at all.";

test("a message from an agent session names it and ends with the commands to answer and acknowledge it, and a session that exited gets none", async (t) => {
  const { web, name, agent, received } = await scratch(t);
  const api = await agent("api", { CLAUDE_CODE_SESSION_ID: "sender" });
  const sent = await api.run([
    "message",
    "--to",
    name,
    "--text",
    "Use revoked_at.",
  ]);
  assert.equal(sent.status, 0, sent.stderr);
  assert.match(
    sent.stdout,
    new RegExp(`^Sent to ${name} \\(Claude Code\\)\\.`),
  );
  const acked = await api.run(["message", "--to", name, "--ack"]);
  assert.equal(acked.status, 0, acked.stderr);
  // pair message registered the sender, which keeps its name when it
  // registers again.
  const sender = JSON.parse((await api.run(["register", "--json"])).stdout);
  const from = `${sender.name} (Claude Code in ${path.join("~", "api")})`;
  assert.deepEqual(received(), [
    `pair message from ${from}:\n\nUse revoked_at.\n\n${answers("claude-code:sender")}`,
    `pair message from ${from} acknowledges your message. Don't answer it.`,
  ]);

  await web.kill();
  const refused = await api.run(["message", "--to", name, "--text", "Here?"]);
  assert.equal(refused.status, 1);
  assert.match(
    refused.stderr,
    new RegExp(`No running agent session .*${name}`),
  );
  assert.equal(received().length, 2);
});

// pair counts a sender as the user only when no agent CLI is among its parent
// processes, and the test itself may run inside one. orphan therefore starts
// pair message from a node process that exits at once, so the system adopts
// the command before pair reads its parent processes. orphan waits for the
// command to exit and returns what it printed.
async function orphan(home, args, env) {
  const output = path.join(home, "orphan.txt");
  const start = `const fd = require("node:fs").openSync(${JSON.stringify(output)}, "w");
const child = require("node:child_process").spawn(process.execPath, ${JSON.stringify([pair, "message", ...args])}, { detached: true, windowsHide: true, stdio: ["ignore", fd, fd] });
process.stdout.write(String(child.pid));
child.unref();`;
  const { stdout } = await exec(process.execPath, ["-e", start], { env });
  assert.ok(await waitUntil(() => !alive(Number(stdout)), 30_000));
  return fs.readFile(output, "utf8");
}

test("a message from outside any agent CLI is from your user, and --ack refuses there", async (t) => {
  const { home, env, name, received } = await scratch(t);
  const plain = { ...outsideAgents, ...env };
  const output = await orphan(
    home,
    ["--to", name, "--text", "Stop here."],
    plain,
  );
  assert.deepEqual(
    received(),
    [`pair message from your user:\n\nStop here.\n\n${noAnswer}`],
    output,
  );
  const refused = await orphan(home, ["--to", name, "--ack"], plain);
  assert.match(refused, /--ack works only inside an agent session/);
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
    `pair message from nightly-ci:\n\nThe nightly build failed.\n\n${noAnswer}`,
  ]);
  assert.equal(
    off.stderr,
    `wake off, not sent: pair message from nightly-ci, for your subagent reviewer. Pass the message below to reviewer unchanged with SendMessage, and do not act on it yourself:\n\nThe nightly build failed.\n\n${noAnswer}\n`,
  );
});

// Codex runs a subagent's commands with the subagent's own thread ID, and pair
// lists only the parent's session. The codex stand-ins here run in the
// daemon's place.
test(
  "a Codex subagent's message names it through its parent, so the receiver answers it there",
  {
    skip:
      process.platform === "win32" &&
      "codexDaemon listens on a Unix socket path, which Node on Windows cannot",
  },
  async (t) => {
    const { name, agent, received } = await scratch(t);
    const spawned = {
      subAgent: {
        thread_spawn: { parent_thread_id: "parent", agent_nickname: "Goodall" },
      },
    };
    const daemon = await codexDaemon(
      t,
      {
        "thread/read": ({ threadId }) => ({
          thread: {
            id: threadId,
            status: { type: "idle" },
            source: threadId === "child" ? spawned : "cli",
          },
        }),
      },
      { inCodexHome: true },
    );
    const codex = (thread) =>
      agent(
        "api",
        { CODEX_HOME: daemon.home, CODEX_THREAD_ID: thread },
        "codex",
      );
    const parent = await codex("parent");
    const registered = await parent.run(["register", "--json"]);
    const { name: api } = JSON.parse(registered.stdout);
    const child = await codex("child");
    const sent = await child.run(["message", "--to", name, "--text", "Done."]);
    assert.equal(sent.status, 0, sent.stderr);
    assert.deepEqual(received(), [
      `pair message from ${api}/Goodall (Codex in ${path.join("~", "api")}):\n\nDone.\n\n${answers("codex:parent/Goodall")}`,
    ]);
  },
);

// opencode gives a subagent's commands the subagent's own session ID, and
// pair's plugin, which this process runs as opencode does, answers with the
// session's parent and title. A task has spaces, so the answer is quoted.
test("an opencode subagent's message names it through its parent by its task", async (t) => {
  const { name, agent, received } = await scratch(t);
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
  const opencode = await agent("api", env, "opencode");
  const as = (session) => ({ env: { PAIR_OPENCODE_SESSION: session } });
  const registered = await opencode.run(["register", "--json"], as("ses_root"));
  const { name: api } = JSON.parse(registered.stdout);
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
  assert.throws(() => findAgent(entries, "codex:0199c1d4"), {
    message:
      "codex:0199c1d4 is the start of the IDs of 2 sessions, api-d3 (codex:0199c1d4-1111) and web-11 (codex:0199c1d4-2222). Give the session's name or more of its ID.",
  });
});
