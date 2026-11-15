import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PairWake } from "../../adapters/opencode/plugin.js";
import serverPlugin from "../../adapters/opencode/server.js";
import { detectWake, identify, wakeRunner } from "../../src/hub/wake.mjs";
import { inProcessState } from "../support/agents.mjs";
import { waitUntil } from "../support/hub.mjs";

// opencode calls each plugin export with its SDK client. standInClient records
// each prompt the plugin sends. While refusal is set, the client returns an
// error as the SDK does.
function standInClient() {
  const prompts = [];
  const client = {
    refusal: null,
    session: {
      async promptAsync(request) {
        if (client.refusal) return { error: client.refusal };
        prompts.push(request);
        return { data: undefined };
      },
    },
  };
  return { client, prompts };
}
const prompt = (id, text) => ({
  path: { id },
  body: { parts: [{ type: "text", text }] },
});

test("an opencode wake prompts the session at once through pair's plugin", async (t) => {
  const { client, prompts } = standInClient();
  const plugin = await PairWake({ client });
  t.after(() => plugin.dispose());
  // opencode calls shell.env with a session ID for a command the agent runs,
  // and without one for a command outside a session.
  const env = {};
  await plugin["shell.env"]({ cwd: "/", sessionID: "ses_1" }, { env });
  const plain = {};
  await plugin["shell.env"]({ cwd: "/" }, { env: plain });
  assert.equal(plain.PAIR_OPENCODE_SESSION, undefined);
  // detectWake does here what pair start does inside opencode: it finds
  // opencode among the process's ancestors and reads the variables that the
  // plugin set for the shell.
  const target = detectWake(env, {
    ancestors: () => [{ pid: 2, command: "opencode" }],
  });
  assert.equal(target.socket, plain.PAIR_OPENCODE_SOCKET);
  assert.deepEqual(identify(target), { harness: "opencode", id: "ses_1" });

  assert.deepEqual(await wakeRunner(target, "first"), {
    via: "prompt",
    steerable: true,
  });
  assert.deepEqual(prompts, [prompt("ses_1", "first")]);

  client.refusal = { name: "NotFoundError", data: { message: "no session" } };
  await assert.rejects(wakeRunner(target, "second"), {
    message: `opencode refused the prompt: ${JSON.stringify(client.refusal)}`,
  });
  await plugin.dispose();
  await assert.rejects(wakeRunner(target, "third"), {
    message: `the agent CLI has exited (ENOENT ${target.socket})`,
  });
});

test("pair's plugin registers an opencode session when opencode creates it, and not a subagent's session", async (t) => {
  const { home, agents } = await inProcessState(t);
  const { client } = standInClient();
  const plugin = await PairWake({ client });
  t.after(() => plugin.dispose());
  const created = (info) =>
    plugin.event({
      event: {
        type: "session.created",
        properties: { info: { directory: home, ...info } },
      },
    });
  // The subagent's session comes first, so that pair register would have
  // listed it by the time it lists the other.
  await created({ id: "ses_child", parentID: "ses_root" });
  await created({ id: "ses_root" });
  // This process stands in for opencode, and its command is node, so pair
  // register finds it only by the process ID that the plugin passes.
  let listed = [];
  assert.ok(
    await waitUntil(async () => (listed = await agents()).length > 0, 30_000),
    "the plugin registered no session",
  );
  assert.deepEqual(
    listed.map(({ id, pid, directory }) => ({ id, pid, directory })),
    [{ id: "opencode:ses_root", pid: process.pid, directory: home }],
  );
});

// opencode's task tool titles a subagent's session "DESCRIPTION (@AGENT
// subagent)", and a prompt without an agent runs under the default agent.
test("an opencode message to a subagent prompts the newest session of that subagent, under its agent", async (t) => {
  const { client, prompts } = standInClient();
  const child = (id, title, agent, created) => ({
    id,
    title: `${title} (@${agent} subagent)`,
    agent,
    time: { created },
  });
  client.session.children = async ({ path: { id } }) => ({
    data:
      id === "ses_1"
        ? [
            child("ses_a", "Review the diff", "reviewer", 1),
            child("ses_b", "Review the diff again", "reviewer", 2),
            child("ses_c", "Find the tests", "explore", 3),
          ]
        : [],
  });
  const plugin = await PairWake({ client });
  t.after(() => plugin.dispose());
  const env = {};
  await plugin["shell.env"]({ sessionID: "ses_1" }, { env });
  const target = detectWake(env, {
    ancestors: () => [{ pid: 2, command: "opencode" }],
  });
  await wakeRunner({ ...target, subagent: "reviewer" }, "first");
  await wakeRunner({ ...target, subagent: "find the tests" }, "second");
  const toAgent = (id, agent, text) => ({
    path: { id },
    body: { agent, parts: [{ type: "text", text }] },
  });
  assert.deepEqual(prompts, [
    toAgent("ses_b", "reviewer", "first"),
    toAgent("ses_c", "explore", "second"),
  ]);
  await assert.rejects(
    wakeRunner({ ...target, subagent: "planner" }, "third"),
    /no subagent named planner/,
  );
});

// adapters/opencode/wake.mjs finds opencode's global config file when the
// module loads, so each case imports its own copy of the module after it
// changes the config folder.
test("start in opencode without the plugin names the config file to add it to", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pair-opencode-"));
  const configHome = process.env.XDG_CONFIG_HOME;
  t.after(() => {
    if (configHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = configHome;
    return fs.rm(home, { recursive: true, force: true });
  });
  process.env.XDG_CONFIG_HOME = home;
  const folder = fileURLToPath(
    new URL("../../adapters/opencode", import.meta.url),
  );
  const refusal = async (copy) =>
    (await import(`../../adapters/opencode/wake.mjs?${copy}`)).unwakeable;
  const line = (file) =>
    `Ask the user to add "${folder}" to "plugin" in ${file}, or "${path.join(folder, "plugin.js")}" on opencode 1, and restart opencode with \`opencode --continue\`, then run this pair command again. This opencode session runs without pair's plugin, so the hub cannot wake it.`;
  const config = path.join(home, "opencode");
  assert.equal(
    await refusal("none"),
    line(path.join(config, "opencode.jsonc")),
  );
  await fs.mkdir(config);
  await fs.writeFile(path.join(config, "opencode.json"), "{}\n");
  assert.equal(await refusal("json"), line(path.join(config, "opencode.json")));
});

// opencode 2 calls the default export's setup with a context that has its
// session, shell and event APIs. standInContext records each prompt and
// delivers each event that emit() adds. While refusal is set, prompt throws as
// opencode does.
function standInContext() {
  const prompts = [];
  const queue = [];
  let next = () => {};
  const ctx = {
    refusal: null,
    children: [],
    shellHook: null,
    emit(event) {
      queue.push(event);
      next();
    },
    session: {
      async prompt(input) {
        if (ctx.refusal) throw ctx.refusal;
        prompts.push(input);
        return {};
      },
      async list({ parentID }) {
        return {
          data: ctx.children.filter((child) => child.parentID === parentID),
          cursor: {},
        };
      },
    },
    shell: {
      async hook(name, callback) {
        assert.equal(name, "create.before");
        ctx.shellHook = callback;
      },
    },
    event: {
      async *subscribe({ types, signal }) {
        assert.deepEqual(types, ["session.created"]);
        while (!signal.aborted) {
          while (queue.length) yield queue.shift();
          await new Promise((resolve) => {
            next = resolve;
            signal.addEventListener("abort", resolve, { once: true });
          });
        }
      },
    },
  };
  return { ctx, prompts };
}

// opencode 2 adds OPENCODE_SESSION_ID to a shell command's environment after
// the plugin's hook runs.
async function shellEnvironment(ctx, session) {
  const env = {};
  await ctx.shellHook({ command: "pair start", cwd: "/", timeout: 1, env });
  return { ...env, OPENCODE_SESSION_ID: session };
}

test("an opencode 2 wake prompts the session at once through pair's plugin", async (t) => {
  const { ctx, prompts } = standInContext();
  const cleanup = await serverPlugin.setup(ctx);
  t.after(() => cleanup());
  const env = await shellEnvironment(ctx, "ses_1");
  const target = detectWake(env, {
    ancestors: () => [{ pid: 2, command: "opencode" }],
  });
  assert.deepEqual(identify(target), { harness: "opencode", id: "ses_1" });

  assert.deepEqual(await wakeRunner(target, "first"), {
    via: "prompt",
    steerable: true,
  });
  assert.deepEqual(prompts, [{ sessionID: "ses_1", text: "first" }]);

  ctx.refusal = new Error("Session not found: ses_1");
  await assert.rejects(wakeRunner(target, "second"), {
    message: "Session not found: ses_1",
  });
  cleanup();
  await assert.rejects(wakeRunner(target, "third"), {
    message: `the agent CLI has exited (ENOENT ${target.socket})`,
  });
});

test("pair's opencode 2 plugin registers a session when opencode creates it, and not a subagent's session", async (t) => {
  const { home, agents } = await inProcessState(t);
  const { ctx } = standInContext();
  const cleanup = await serverPlugin.setup(ctx);
  t.after(() => cleanup());
  const created = (data) =>
    ctx.emit({
      type: "session.created",
      data: { location: { directory: home }, ...data },
    });
  // The subagent's session comes first, so that pair register would have
  // listed it by the time it lists the other.
  created({ sessionID: "ses_child", parentID: "ses_root" });
  created({ sessionID: "ses_root" });
  // This process stands in for opencode's server, and its command is node, so
  // pair register finds it only by the process ID that the plugin passes.
  let listed = [];
  assert.ok(
    await waitUntil(async () => (listed = await agents()).length > 0, 30_000),
    "the plugin registered no session",
  );
  assert.deepEqual(
    listed.map(({ id, pid, directory }) => ({ id, pid, directory })),
    [{ id: "opencode:ses_root", pid: process.pid, directory: home }],
  );
});

// opencode 2's task tool titles a subagent's session with its task.
test("an opencode 2 message to a subagent prompts the newest session with that task or agent", async (t) => {
  const { ctx, prompts } = standInContext();
  const child = (id, title, agent, created) => ({
    id,
    parentID: "ses_1",
    title,
    agent,
    time: { created },
  });
  ctx.children = [
    child("ses_a", "Review the diff", "reviewer", 1),
    child("ses_b", "Review the diff again", "reviewer", 2),
    child("ses_c", "Find the tests", "explore", 3),
  ];
  const cleanup = await serverPlugin.setup(ctx);
  t.after(() => cleanup());
  const target = detectWake(await shellEnvironment(ctx, "ses_1"), {
    ancestors: () => [{ pid: 2, command: "opencode" }],
  });
  await wakeRunner({ ...target, subagent: "reviewer" }, "first");
  await wakeRunner({ ...target, subagent: "find the tests" }, "second");
  assert.deepEqual(prompts, [
    { sessionID: "ses_b", text: "first" },
    { sessionID: "ses_c", text: "second" },
  ]);
  await assert.rejects(
    wakeRunner({ ...target, subagent: "planner" }, "third"),
    /no subagent named planner/,
  );
});
