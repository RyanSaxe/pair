import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));

// pi's extension and opencode's plugin call register when a session starts,
// as a start hook does in the other CLIs. pi sets the session's variables in
// its own environment, and opencode's plugin passes them in variables.
//
// pair needs a newer Node than the one pi may run on, and opencode runs
// plugins on Bun, so register runs pair with the node on the path. The
// command gets no terminal and an empty stdin, its failures are ignored, and
// the CLI does not wait for it, so it cannot disturb the CLI. A session that
// it fails to register registers at its first pair command.
export function register(cwd, variables = {}) {
  try {
    const child = spawn("node", [cli, "register", "--hook"], {
      cwd,
      env: { ...process.env, ...variables },
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    // spawn throws at once for some failures, such as a cwd that is not a
    // folder, and the session then registers at its first pair command.
  }
}
