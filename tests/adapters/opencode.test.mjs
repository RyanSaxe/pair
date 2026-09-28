import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PairWake } from "../../adapters/opencode/plugin.js";
import { detectWake, identify, wakeRunner } from "../../src/hub/wake.mjs";

// opencode calls each plugin export with its SDK client. This stand-in
// client records each prompt the plugin sends, and returns an error, as the
// SDK does, while refusal is set.
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
const status = (sessionID, type) => ({
  event: {
    type: "session.status",
    properties: { sessionID, status: { type } },
  },
});
const prompt = (id, ...lines) => ({
  path: { id },
  body: { parts: lines.map((text) => ({ type: "text", text })) },
});

test("an opencode wake prompts an idle session and waits for a busy one", async (t) => {
  const { client, prompts } = standInClient();
  const plugin = await PairWake({ client });
  t.after(() => plugin.dispose());
  // opencode passes the session ID to shell.env for commands the agent runs,
  // and not for commands without a session.
  const env = {};
  await plugin["shell.env"]({ cwd: "/", sessionID: "ses_1" }, { env });
  const plain = {};
  await plugin["shell.env"]({ cwd: "/" }, { env: plain });
  assert.deepEqual(Object.keys(plain), ["PAIR_OPENCODE_SOCKET"]);
  // pair start inside opencode finds opencode among its ancestors and reads
  // the variables the plugin gave its shell.
  const target = detectWake(env, {
    ancestors: () => [{ pid: 2, command: "opencode" }],
  });
  assert.equal(target.socket, plain.PAIR_OPENCODE_SOCKET);
  assert.deepEqual(identify(target), { harness: "opencode", id: "ses_1" });

  await wakeRunner(target, "first");
  assert.deepEqual(prompts, [prompt("ses_1", "first")]);
  // While the session runs a request, the wake succeeds and the plugin sends
  // nothing until the session is idle, then sends every line in one prompt.
  await plugin.event(status("ses_1", "busy"));
  await wakeRunner(target, "second");
  await wakeRunner(target, "third");
  assert.equal(prompts.length, 1);
  await plugin.event(status("ses_1", "idle"));
  assert.deepEqual(prompts, [
    prompt("ses_1", "first"),
    prompt("ses_1", "second", "third"),
  ]);

  client.refusal = { name: "NotFoundError", data: { message: "no session" } };
  await assert.rejects(wakeRunner(target, "fourth"), {
    message: `opencode refused the prompt: ${JSON.stringify(client.refusal)}`,
  });
  await plugin.dispose();
  await assert.rejects(wakeRunner(target, "fifth"), {
    message: `the agent CLI has exited (ENOENT ${target.socket})`,
  });
});

// The refusal names the global config file opencode reads, found when the
// module loads, so each case imports its own copy after setting the folder.
test("start in opencode without the plugin names the config file to add it to", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pair-opencode-"));
  const configHome = process.env.XDG_CONFIG_HOME;
  t.after(() => {
    if (configHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = configHome;
    return fs.rm(home, { recursive: true, force: true });
  });
  process.env.XDG_CONFIG_HOME = home;
  const plugin = fileURLToPath(
    new URL("../../adapters/opencode/plugin.js", import.meta.url),
  );
  const refusal = async (copy) =>
    (await import(`../../adapters/opencode/wake.mjs?${copy}`)).unwakeable;
  const line = (file) =>
    `this opencode session runs without pair's plugin, so it cannot be woken. Add "${plugin}" to "plugin" in ${file}, restart opencode with \`opencode --continue\`, and run \`pair start\` again.`;
  const config = path.join(home, "opencode");
  assert.equal(
    await refusal("none"),
    line(path.join(config, "opencode.jsonc")),
  );
  await fs.mkdir(config);
  await fs.writeFile(path.join(config, "opencode.json"), "{}\n");
  assert.equal(await refusal("json"), line(path.join(config, "opencode.json")));
});
