import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { withSandboxHint } from "../../adapters/codex/rules.mjs";
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
