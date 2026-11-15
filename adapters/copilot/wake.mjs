import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { commandLine } from "../../src/shared/processes.mjs";

const here = fileURLToPath(import.meta.url);
const execFileAsync = promisify(execFile);

export const name = "Copilot CLI";

// The port changes when Copilot restarts, and the session ID does not.
export const identity = (target) => target.sessionId;

// Copilot gives a sessionStart hook the session ID as sessionId on stdin.
export const hookVariables = (input) => ({
  COPILOT_AGENT_SESSION_ID: input.sessionId,
});

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
// Copilot runs as its own executable, except where a package manager, such
// as nixpkgs or npm on Windows, runs Copilot's index.js with node. Copilot's
// SDK is in the folder of that index.js, so copilotScript returns the folder,
// or null for a node process that runs something else.
function copilotScript(pid) {
  const args = commandLine(pid);
  if (!args) return null;
  const words = [...args.matchAll(/"([^"]+)"|(\S+)/g)].map(
    ([, quoted, bare]) => quoted ?? bare,
  );
  const script = words.find(
    (word) =>
      path.basename(word) === "index.js" &&
      existsSync(path.join(path.dirname(word), "copilot-sdk", "index.js")),
  );
  return script ? path.dirname(script) : null;
}

export const recognizes = (ancestor, { script = copilotScript } = {}) =>
  ancestor.command === "node" && script(ancestor.pid) !== null;

function copilotSdk(env, ancestor) {
  const folder =
    ancestor?.command === "node" ? copilotScript(ancestor.pid) : null;
  const roots = [
    env.COPILOT_PKG_CACHE_HOME,
    path.join(os.homedir(), "Library", "Caches", "copilot"),
    env.XDG_CACHE_HOME && path.join(env.XDG_CACHE_HOME, "copilot"),
    path.join(os.homedir(), ".cache", "copilot"),
  ].filter(Boolean);
  const tried = [
    ...(folder ? [path.join(folder, "copilot-sdk", "index.js")] : []),
    ...roots.map((root) =>
      path.join(
        root,
        "pkg",
        `${process.platform}-${process.arch}`,
        env.COPILOT_CLI_BINARY_VERSION || "",
        "copilot-sdk",
        "index.js",
      ),
    ),
  ];
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
      `Ask the user to restart Copilot with \`copilot --ui-server --resume ${sessionId}\`, then run this pair command again. This Copilot session was started without \`--ui-server\`, so the hub cannot wake it.`,
    );
  const { sdk, tried } = findSdk(env, ancestor);
  if (!sdk)
    throw new Error(
      `Tell the user that the Copilot SDK was not found at ${tried.join(", ")}, so the hub cannot wake this session, and stop.`,
    );
  return { harness: "copilot", sessionId, port, sdk };
}

// The hub runs this file as a child process to send, so a broken SDK cannot
// crash the hub. With the send mode immediate, Copilot adds the line to the
// turn in progress at once and moves a running shell command to the background.
// When Copilot is idle, it starts a turn with the line. When Copilot refuses
// immediate, wake() sends the line with enqueue, and Copilot reads it when its
// turn ends.
//
// With target.subagent, the child sends the line to that subagent of the
// session instead, through the SDK's experimental tasks.sendMessage. A
// running subagent reads it in its current turn, and an idle one starts a turn
// with it.
export async function wake(target, line, run) {
  const send = (mode) =>
    run(process.execPath, [
      here,
      target.sdk,
      String(target.port),
      target.sessionId,
      mode,
      line,
      ...(target.subagent ? [target.subagent] : []),
    ]);
  if (target.subagent) {
    await send("subagent");
    return { via: "subagent", steerable: true };
  }
  try {
    await send("immediate");
    return { via: "immediate", steerable: true };
  } catch {
    await send("enqueue");
    return { via: "enqueue", steerable: false };
  }
}

// Copilot gives a subagent's commands the subagent's own session ID, which
// Copilot's server has no session for, so the subagent would register as a
// session of its own and replace its parent's entry. serverSession gives such
// a session the server's foreground session as its parent. Copilot names no
// subagent by that ID, so the parent comes without a nickname.
export async function serverSession(target) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [here, target.sdk, String(target.port), target.sessionId, "parent"],
    { timeout: 30_000 },
  );
  const { known, foreground } = JSON.parse(stdout);
  return {
    loaded: false,
    parent:
      !known && foreground && foreground !== target.sessionId
        ? { sessionId: foreground }
        : null,
  };
}

// pair message tries tasks.sendMessage first. When it fails, pair message asks
// the parent's agent to pass the message on with write_agent, Copilot's tool
// for a message to a background subagent.
export const reachesSubagents = true;
export const subagentTool = () => "write_agent";

// A subagent's task has the name the parent gave it as displayName, and the
// task it was given as description.
async function sendToSubagent(session, name, message) {
  const { tasks } = await session.rpc.tasks.list();
  const wanted = name.toLowerCase();
  const named = tasks.filter(
    (task) =>
      task.type === "agent" &&
      [task.displayName, task.description].some(
        (each) => each?.toLowerCase() === wanted,
      ),
  );
  if (named.length !== 1)
    throw new Error(
      `Copilot has ${named.length} subagents named ${name}, and pair sends to one.`,
    );
  const { sent, error } = await session.rpc.tasks.sendMessage({
    id: named[0].id,
    message,
  });
  if (!sent) throw new Error(error || "Copilot did not send the message.");
}

// This block runs only in the child process. It connects to the TUI's embedded
// server through the SDK shipped inside the CLI, resumes the session, and sends
// one prompt in the given mode, or to the subagent named after the line. With
// the mode parent, it prints whether the server has the session and the
// server's foreground session instead.
if (process.argv[1] === here) {
  const [sdk, port, sessionId, mode, line, subagent] = process.argv.slice(2);
  const { CopilotClient, approveAll } = await import(pathToFileURL(sdk).href);
  const client = new CopilotClient({
    connection: { kind: "uri", url: `http://127.0.0.1:${port}` },
    logLevel: "error",
  });
  await client.start();
  try {
    if (mode === "parent") {
      const known = Boolean(await client.getSessionMetadata(sessionId));
      const foreground = await client.getForegroundSessionId();
      process.stdout.write(JSON.stringify({ known, foreground }));
    } else {
      const session = await client.resumeSession(sessionId, {
        onPermissionRequest: approveAll,
      });
      if (mode === "subagent") await sendToSubagent(session, subagent, line);
      else await session.send({ prompt: line, mode });
    }
  } finally {
    await client.stop();
  }
}
