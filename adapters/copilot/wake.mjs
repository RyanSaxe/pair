import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(import.meta.url);

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
export function detect(
  env,
  {
    ancestor,
    listeningPort: portOf = listeningPort,
    copilotSdk: findSdk = copilotSdk,
  },
) {
  if (ancestor ? ancestor.command !== "copilot" : !env.COPILOT_AGENT_SESSION_ID)
    return null;
  const sessionId = env.COPILOT_AGENT_SESSION_ID;
  if (!sessionId)
    throw new Error(
      "this Copilot session exports no COPILOT_AGENT_SESSION_ID, so it cannot be woken.",
    );
  const port = ancestor ? portOf(ancestor.pid) : null;
  if (!port)
    throw new Error(
      `this Copilot session cannot be woken. Restart it with \`copilot --ui-server --resume ${sessionId}\` and run start again.`,
    );
  const { sdk, tried } = findSdk(env);
  if (!sdk)
    throw new Error(
      `the Copilot SDK was not found at ${tried.join(", ")}, so this session cannot be woken.`,
    );
  return { harness: "copilot", sessionId, port, sdk };
}

// The hub runs this file as a child process to send, so a broken SDK cannot
// take the hub down.
export async function wake(target, line, run) {
  await run(process.execPath, [
    here,
    target.sdk,
    String(target.port),
    target.sessionId,
    line,
  ]);
}

// In the child: connect to the TUI's embedded server through the SDK shipped
// inside the CLI, resume the session, and enqueue one prompt.
if (process.argv[1] === here) {
  const [sdk, port, sessionId, line] = process.argv.slice(2);
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
    await session.send({ prompt: line, mode: "enqueue" });
  } finally {
    await client.stop();
  }
}
