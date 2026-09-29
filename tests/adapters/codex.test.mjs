import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { withSandboxHint } from "../../adapters/codex/rules.mjs";
import { wakeRunner } from "../../src/hub/wake.mjs";
import { exec, pair } from "../support/hub.mjs";

test("the Codex rules allow pair, and check reports Codex's sandbox", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "pair-codex-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const env = {
    ...process.env,
    CODEX_HOME: path.join(home, "codex"),
    XDG_STATE_HOME: path.join(home, "state"),
    PAIR_HUB_PORT: "0",
  };
  await exec(process.execPath, [pair, "check", "--codex-rules"], { env });
  assert.equal(
    await fs.readFile(path.join(home, "codex", "rules", "pair.rules"), "utf8"),
    'prefix_rule(pattern=["pair"], decision="allow", justification="pair: the command talks to its local hub and writes the session under the state directory")\n',
  );
  const probe = path.join(home, "probe");
  await fs.mkdir(probe);
  const { stdout } = await exec(process.execPath, [pair, "check", probe], {
    env: { ...env, CODEX_SANDBOX: "seatbelt" },
  });
  assert.equal(JSON.parse(stdout).codex.present, true);
});

test("the sandbox hint follows a refusal, not the environment alone", () => {
  const env = { CODEX_SANDBOX: "seatbelt" };
  assert.match(
    withSandboxHint("connect EPERM 127.0.0.1:4747", env),
    /outside the sandbox/,
  );
  assert.equal(withSandboxHint("Unknown session", env), "Unknown session");
  assert.equal(
    withSandboxHint("connect EPERM 127.0.0.1:4747", {}),
    "connect EPERM 127.0.0.1:4747",
  );
});

// The hub wakes a Codex session by running codex queue. The stand-in codex
// first on PATH records its arguments, and fails as codex does when it
// cannot queue the message.
// npm installs Codex on Windows as codex.cmd, which the adapter's execFile
// cannot run without a shell, so a Codex wake does not work there yet.
test(
  "a Codex wake queues the line on the session's thread",
  {
    skip:
      process.platform === "win32" && "a Codex wake needs codex.cmd support",
  },
  async (t) => {
    const bin = await fs.mkdtemp(path.join(os.tmpdir(), "pair-codex-"));
    const searched = process.env.PATH;
    process.env.PATH = bin + path.delimiter + searched;
    t.after(() => {
      process.env.PATH = searched;
      delete process.env.PAIR_TEST_FAIL;
      return fs.rm(bin, { recursive: true, force: true });
    });
    const log = path.join(bin, "arguments.json");
    await fs.writeFile(
      path.join(bin, "codex"),
      `#!${process.execPath}
require("node:fs").writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));
if (process.env.PAIR_TEST_FAIL) {
  console.error("thread gone");
  process.exit(1);
}
`,
      { mode: 0o755 },
    );
    const target = { harness: "codex", thread: "thread-1" };
    const line = "pair: the reviewer submitted round 1 of session /s.";
    await wakeRunner(target, line);
    assert.deepEqual(JSON.parse(await fs.readFile(log, "utf8")), [
      "queue",
      "--thread",
      "thread-1",
      "--message",
      line,
    ]);
    // The hub records this message as the wake's reason.
    process.env.PAIR_TEST_FAIL = "1";
    await assert.rejects(wakeRunner(target, line), /^Error: thread gone$/);
  },
);
