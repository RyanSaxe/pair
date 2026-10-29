import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PairWake } from "../../adapters/opencode/plugin.js";
import { detectWake, identify, wakeRunner } from "../../src/hub/wake.mjs";

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
  assert.deepEqual(Object.keys(plain), ["PAIR_OPENCODE_SOCKET"]);
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
  const plugin = fileURLToPath(
    new URL("../../adapters/opencode/plugin.js", import.meta.url),
  );
  const refusal = async (copy) =>
    (await import(`../../adapters/opencode/wake.mjs?${copy}`)).unwakeable;
  const line = (file) =>
    `Ask the user to add "${plugin}" to "plugin" in ${file} and restart opencode with \`opencode --continue\`, then run \`pair start\` again. This opencode session runs without pair's plugin, so the hub cannot wake it.`;
  const config = path.join(home, "opencode");
  assert.equal(
    await refusal("none"),
    line(path.join(config, "opencode.jsonc")),
  );
  await fs.mkdir(config);
  await fs.writeFile(path.join(config, "opencode.json"), "{}\n");
  assert.equal(await refusal("json"), line(path.join(config, "opencode.json")));
});
