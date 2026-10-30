import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { settings } from "../../src/shared/settings.mjs";
import { exec, root } from "../support/hub.mjs";

async function copyPackage(t) {
  const copy = await fs.mkdtemp(path.join(os.tmpdir(), "pair-copy-"));
  t.after(() => fs.rm(copy, { recursive: true, force: true }));
  const { files } = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  );
  for (const entry of ["package.json", ...files])
    await fs.cp(path.join(root, entry), path.join(copy, entry), {
      recursive: true,
    });
  return copy;
}

// A pair command stops an idle hub whose version differs from its own and
// starts one on its own code. The hub also runs the builder, so an edit to
// src/build/ must change the version.
test("the hub version changes when any file the hub runs changes", async (t) => {
  const copy = await copyPackage(t);
  const settings = pathToFileURL(path.join(copy, "src/shared/settings.mjs"));
  const version = async () =>
    (
      await exec(process.execPath, [
        "--input-type=module",
        "-e",
        `import { version } from "${settings}"; console.log(version);`,
      ])
    ).stdout;
  const before = await version();
  await fs.appendFile(path.join(copy, "src/build/lint.mjs"), "\n// edited\n");
  assert.notEqual(await version(), before);
});

test("PAIR_WAKE=off turns wakes off only with a state directory of its own", () => {
  const home = path.join(os.tmpdir(), "pair-scratch-state");
  assert.equal(settings({}).wake, true);
  assert.equal(
    settings({ XDG_STATE_HOME: home, PAIR_WAKE: "off" }).wake,
    false,
  );
  assert.throws(
    () => settings({ XDG_STATE_HOME: home, PAIR_WAKE: "maybe" }),
    /PAIR_WAKE must be on or off/,
  );
  assert.throws(
    () => settings({ PAIR_WAKE: "off" }),
    /Set PAIR_WAKE=off only for a scratch hub/,
  );
});

// Node's listen binds every one of these spellings of the unspecified address
// to every interface. A URL writes :: as [::].
test("PAIR_HUB_HOST refuses every spelling of the unspecified address", () => {
  for (const host of [
    "0.0.0.0",
    "0",
    "0x0",
    "000.000.000.000",
    "::",
    "[::]",
    "0:0:0:0:0:0:0:0",
    "::ffff:0.0.0.0",
  ])
    assert.throws(() => settings({ PAIR_HUB_HOST: host }), {
      message: `PAIR_HUB_HOST is ${host}, which would make the hub reachable from every network this machine is on. Set it to this machine's address on a network you trust.`,
    });
  for (const host of ["100.64.1.2", "fd7a:115c:a1e0::1", "mac.tail1.ts.net"])
    assert.equal(settings({ PAIR_HUB_HOST: host }).host, host);
});

// Each range in engines.node gives the lowest supported release of one Node
// major line. pair check refuses a release below that and a line that no range
// covers.
test("pair check holds the running Node to the floor of its line", async (t) => {
  const copy = await copyPackage(t);
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "pair-node-"));
  t.after(() => fs.rm(state, { recursive: true, force: true }));
  const running = process.versions.node;
  const [line, minor, patch] = running.split(".").map(Number);
  const check = async (range) => {
    const file = path.join(copy, "package.json");
    const json = JSON.parse(await fs.readFile(file, "utf8"));
    await fs.writeFile(
      file,
      JSON.stringify({ ...json, engines: { node: range } }),
    );
    return exec(process.execPath, [path.join(copy, "src/cli.mjs"), "check"], {
      env: { ...process.env, XDG_STATE_HOME: state, PAIR_HUB_PORT: "0" },
    });
  };
  const nodeLine = async (range) =>
    (await check(range)).stdout.match(/^node +(.*)$/m)[1];
  const refuses = (range, message) =>
    assert.rejects(check(range), (error) => {
      assert.equal(error.stderr, `pair: ${message}\n`);
      return true;
    });
  assert.equal(
    await nodeLine(`^${line - 2}.0.0 || ^${running} || >=${line + 1}.0.0`),
    `${running}, and pair needs ${running} or newer on Node ${line}`,
  );
  assert.equal(
    await nodeLine(`^${line - 2}.0.0 || >=${line - 1}.0.0`),
    `${running}, and pair needs ${line - 1}.0.0 or newer`,
  );
  const newer = `${line}.${minor}.${patch + 1}`;
  await refuses(
    `^${line - 2}.0.0 || >=${newer}`,
    `Node ${running} is missing security fixes that Node released in ${newer}. Update Node to ${newer} or newer.`,
  );
  await refuses(
    `^${line - 2}.0.0 || ^${line - 1}.0.0 || >=${line + 1}.0.0`,
    `Node ${running} is not supported. Use Node ${line - 2}.0.0 or newer in ${line - 2}, ${line - 1}.0.0 or newer in ${line - 1}, or ${line + 1}.0.0 or newer.`,
  );
});
