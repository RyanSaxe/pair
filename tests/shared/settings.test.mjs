import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { settings } from "../../src/shared/settings.mjs";
import { exec, root } from "../support/hub.mjs";

// A hub restarts on newer code only when its version changes, and the hub
// runs the build as well as its own modules.
test("the hub version changes when any file the hub runs changes", async (t) => {
  const copy = await fs.mkdtemp(path.join(os.tmpdir(), "pair-version-"));
  t.after(() => fs.rm(copy, { recursive: true, force: true }));
  const { files } = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  );
  for (const entry of ["package.json", ...files])
    await fs.cp(path.join(root, entry), path.join(copy, entry), {
      recursive: true,
    });
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

// Every spelling of the unspecified address that Node's listen binds to every
// interface, and [::], which a URL writes for ::.
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
