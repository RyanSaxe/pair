#!/usr/bin/env node
import { main as build } from "./build.mjs";
import { main as check } from "./check.mjs";
import { main as diff } from "./components/before-after/diff.mjs";
import { main as session, withSandboxHint } from "./session.mjs";

const usage = `Usage: pair start [--session-dir PATH]
       pair ack|read|publish|progress|pause|complete|status --session-dir PATH [options]
       pair build SOURCE.json OUTPUT.html
       pair diff BEFORE AFTER OUTPUT.json
       pair check [--codex-rules | STATE_DIR]`;

// The session commands talk to the hub. hub is the command start spawns.
const sessionCommands = new Set([
  "start",
  "ack",
  "read",
  "publish",
  "progress",
  "pause",
  "complete",
  "status",
  "hub",
]);
const tools = { build, diff, check };

const [command, ...args] = process.argv.slice(2);
if (sessionCommands.has(command)) {
  await session([command, ...args]).catch((error) => {
    console.error(`pair: ${withSandboxHint(error.message)}`);
    process.exitCode = 1;
  });
} else if (Object.hasOwn(tools, command)) {
  await tools[command](args).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
} else {
  console.error(usage);
  process.exitCode = 1;
}
