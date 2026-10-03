import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(import.meta.url);

export const name = "Copilot CLI";

// The port changes when Copilot restarts, and the session ID does not.
export const identity = (target) => target.sessionId;

function listeningPort(pid) {
  try {
    const out = execFileSync(
      "lsof",
      ["-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN", "-nP", "-Fn"],
      { encoding: "utf8" },
    );
    const match = /^n127\.0\.0\.1:(\d+)$/m.exec(out);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}
function copilotSdk(env) {
  const roots = [
    env.COPILOT_PKG_CACHE_HOME,
    path.join(os.homedir(), "Library", "Caches", "copilot"),
    env.XDG_CACHE_HOME && path.join(env.XDG_CACHE_HOME, "copilot"),
    path.join(os.homedir(), ".cache", "copilot"),
  ].filter(Boolean);
  const tried = roots.map((root) =>
    path.join(
      root,
      "pkg",
      `${process.platform}-${process.arch}`,
      env.COPILOT_CLI_BINARY_VERSION || "",
      "copilot-sdk",
      "index.js",
    ),
  );
  return {
    sdk: tried.find((candidate) => existsSync(candidate)) || null,
    tried,
  };
}

// Copilot exports the session ID to the commands it runs, and listens for
// the SDK only when it was started with --ui-server.
export const command = "copilot";
export const variables = ["COPILOT_AGENT_SESSION_ID"];
export const unwakeable =
  "Tell the user that this Copilot session exports no COPILOT_AGENT_SESSION_ID, so the hub cannot wake it, and stop.";
export function detect(
  env,
  {
    ancestor,
    listeningPort: portOf = listeningPort,
    copilotSdk: findSdk = copilotSdk,
  },
) {
  const sessionId = env.COPILOT_AGENT_SESSION_ID;
  const port = ancestor ? portOf(ancestor.pid) : null;
  if (!port)
    throw new Error(
      `Ask the user to restart Copilot with \`copilot --ui-server --resume ${sessionId}\`, then run \`pair start\` again. This Copilot session was started without \`--ui-server\`, so the hub cannot wake it.`,
    );
  const { sdk, tried } = findSdk(env);
  if (!sdk)
    throw new Error(
      `Tell the user that the Copilot SDK was not found at ${tried.join(", ")}, so the hub cannot wake this session, and stop.`,
    );
  return { harness: "copilot", sessionId, port, sdk };
}

// The hub runs this file as a child process to send, so a broken SDK cannot
// take the hub down. With the send mode immediate, Copilot adds the line to
// the turn in progress at once, and moves a running shell command to the
// background. When Copilot is idle, the line starts a turn. When Copilot
// refuses immediate, the adapter sends the line with enqueue, and Copilot
// reads it when its turn ends.
export async function wake(target, line, run) {
  const send = (mode) =>
    run(process.execPath, [
      here,
      target.sdk,
      String(target.port),
      target.sessionId,
      mode,
      line,
    ]);
  try {
    await send("immediate");
    return { via: "immediate", steerable: true };
  } catch {
    await send("enqueue");
    return { via: "enqueue", steerable: false };
  }
}

// In the child: connect to the TUI's embedded server through the SDK shipped
// inside the CLI, resume the session, and send one prompt in the given mode.
if (process.argv[1] === here) {
  const [sdk, port, sessionId, mode, line] = process.argv.slice(2);
  const { CopilotClient, approveAll } = await import(pathToFileURL(sdk).href);
  const client = new CopilotClient({
    connection: { kind: "uri", url: `http://127.0.0.1:${port}` },
    logLevel: "error",
  });
  await client.start();
  try {
    const session = await client.resumeSession(sessionId, {
      onPermissionRequest: approveAll,
    });
    await session.send({ prompt: line, mode });
  } finally {
    await client.stop();
  }
}
