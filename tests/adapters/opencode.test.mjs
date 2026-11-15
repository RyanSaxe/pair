import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PairWake } from "../../adapters/opencode/plugin.js";
import serverPlugin from "../../adapters/opencode/server.js";
import tuiPlugin from "../../adapters/opencode/tui.js";
import { running } from "../../adapters/opencode/wake.mjs";
import { windowsDir } from "../../adapters/opencode/windows.mjs";
import { processTable } from "../../src/shared/processes.mjs";
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

// One opencode process serves several sessions, and this process stands in
// for it. Its command is node, so pair register finds it only by the process
// ID that the plugin passes.
test("pair's plugin registers each opencode session when opencode creates it, and not a subagent's session", async (t) => {
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
  const listed = async (count) => {
    let entries = [];
    await waitUntil(
      async () => (entries = await agents()).length >= count,
      30_000,
    );
    return entries.map(({ id, pid }) => ({ id, pid })).reverse();
  };
  // The subagent's session comes first, so that pair register would have
  // listed it by the time it lists the others.
  await created({ id: "ses_child", parentID: "ses_root" });
  await created({ id: "ses_root" });
  assert.deepEqual(await listed(1), [
    { id: "opencode:ses_root", pid: process.pid },
  ]);
  await created({ id: "ses_new" });
  assert.deepEqual(await listed(2), [
    { id: "opencode:ses_root", pid: process.pid },
    { id: "opencode:ses_new", pid: process.pid },
  ]);
});

// opencode 1's task tool titles a subagent's session "TASK (@AGENT
// subagent)", and a prompt without an agent runs under the default agent.
test("an opencode message to a subagent prompts the newest session of that subagent, under its agent", async (t) => {
  const { client, prompts } = standInClient();
  const child = (id, task, agent, created) => ({
    id,
    title: `${task} (@${agent} subagent)`,
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
// delivers each event that emit() adds.
function standInContext() {
  const prompts = [];
  const queue = [];
  let next = () => {};
  const ctx = {
    children: [],
    shellHook: null,
    emit(event) {
      queue.push(event);
      next();
    },
    session: {
      async get() {
        return { title: "Fix the login" };
      },
      async prompt(input) {
        prompts.push(input);
      },
      async list({ parentID }) {
        return {
          data: ctx.children.filter((child) => child.parentID === parentID),
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
async function opencode2Target(ctx, session) {
  const env = {};
  await ctx.shellHook({ command: "pair start", cwd: "/", env });
  return detectWake(
    { ...env, OPENCODE_SESSION_ID: session },
    { ancestors: () => [{ pid: 2, command: "opencode" }] },
  );
}

// tui.js runs in each opencode 2 window, and this process stands in for one.
const openWindow = (sessions) =>
  tuiPlugin.setup({
    ui: {
      tabs: {
        enabled: () => true,
        list: () => sessions.map((sessionID) => ({ sessionID })),
      },
      router: { current: () => ({ type: "home" }) },
    },
  });

// opencode 2's background server keeps running after every window exits, so
// a session counts as running while a window has it open. pair's plugin
// registers a session when opencode creates it, before its window lists it.
test("pair's opencode 2 plugin registers each session but a subagent's, which pair agents lists while a window has it open", async (t) => {
  const { home, agents } = await inProcessState(t);
  const { ctx } = standInContext();
  const cleanup = await serverPlugin.setup(ctx);
  t.after(() => cleanup());
  const created = (data) =>
    ctx.emit({
      type: "session.created",
      data: { location: { directory: home }, ...data },
    });
  created({ sessionID: "ses_child", parentID: "ses_root" });
  created({ sessionID: "ses_root" });
  const entry = path.join(
    home,
    "state",
    "pair",
    "agents",
    "opencode-ses_root.json",
  );
  assert.ok(
    await waitUntil(
      () =>
        fs.access(entry).then(
          () => true,
          () => false,
        ),
      30_000,
    ),
    "the plugin registered no session",
  );
  const closeWindow = openWindow(["ses_root", "ses_child"]);
  t.after(() => closeWindow());
  assert.deepEqual(
    (await agents()).map(({ id, pid }) => ({ id, pid })),
    [{ id: "opencode:ses_root", pid: process.pid }],
  );
  closeWindow();
  assert.deepEqual(await agents(), []);
});

test("an opencode 2 session runs only while a window with the start time it recorded has it open", async (t) => {
  await inProcessState(t);
  const { ctx } = standInContext();
  const cleanup = await serverPlugin.setup(ctx);
  t.after(() => cleanup());
  const target = await opencode2Target(ctx, "ses_1");
  const runs = (session) => running({ ...target, session });
  const closeWindow = openWindow(["ses_1"]);
  assert.equal(await runs("ses_1"), true);
  assert.equal(await runs("ses_2"), false);
  closeWindow();
  assert.equal(await runs("ses_1"), false);
  // A window that exits without unloading the plugin leaves its file, and a
  // new process can get its ID.
  const file = path.join(windowsDir(), `${process.pid}.json`);
  const window = (start) =>
    fs.writeFile(file, JSON.stringify({ start, sessions: ["ses_1"] }));
  await window("Thu Jan 1 00:00:00 1970");
  assert.equal(await runs("ses_1"), false);
  await window(processTable().get(process.pid).start);
  assert.equal(await runs("ses_1"), true);
});

// opencode 2's task tool titles a subagent's session with its task.
test("an opencode 2 wake prompts the session, or the newest subagent session with that task or agent", async (t) => {
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
  const target = await opencode2Target(ctx, "ses_1");
  assert.deepEqual(identify(target), { harness: "opencode", id: "ses_1" });
  assert.deepEqual(await wakeRunner(target, "first"), {
    via: "prompt",
    steerable: true,
  });
  await wakeRunner({ ...target, subagent: "reviewer" }, "second");
  await wakeRunner({ ...target, subagent: "find the tests" }, "third");
  assert.deepEqual(prompts, [
    { sessionID: "ses_1", text: "first" },
    { sessionID: "ses_b", text: "second" },
    { sessionID: "ses_c", text: "third" },
  ]);
});
