import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { commands } from "../../src/cli/commands.mjs";
import { exec, pair, root } from "../support/hub.mjs";

async function scratch(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pair-help-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cwd = path.join(directory, "work");
  const state = path.join(directory, "state");
  await fs.mkdir(cwd);
  await fs.mkdir(state);
  const run = (...args) =>
    exec(process.execPath, [pair, ...args], {
      cwd,
      env: { ...process.env, XDG_STATE_HOME: state, PAIR_HUB_PORT: "0" },
    });
  return { cwd, state, run };
}

// An agent asks for help to learn a command before it runs it, so --help
// prints the command's help and runs nothing else, whatever else the
// arguments contain: no check, no hub, no file.
test("every command takes --help, prints its usage, exits 0 and runs nothing", async (t) => {
  const { cwd, state, run } = await scratch(t);
  const names = Object.entries(commands).flatMap(([name, entry]) =>
    entry.subcommands
      ? [name, ...Object.keys(entry.subcommands).map((sub) => `${name} ${sub}`)]
      : [name],
  );
  for (const name of names) {
    const { stdout } = await run(...name.split(" "), "--help", "extra");
    const { hidden } = commands[name.split(" ")[0]];
    if (!hidden) assert.match(stdout, new RegExp(`\nUsage: pair ${name}\\b`));
    else assert(stdout.trim(), name);
  }
  assert.deepEqual(await fs.readdir(cwd), []);
  assert.deepEqual(await fs.readdir(state), []);
});

test("pair --version prints the version, and pair with no command or an unknown one exits 1", async (t) => {
  const { run } = await scratch(t);
  const { version } = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  );
  assert.equal((await run("--version")).stdout, `${version}\n`);
  await assert.rejects(run(), { code: 1 });
  await assert.rejects(run("nope"), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /\bnope\b/);
    return true;
  });
});
