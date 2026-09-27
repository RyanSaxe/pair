#!/usr/bin/env node
import { withSandboxHint } from "../adapters/codex/rules.mjs";
import { main as build } from "./cli/build.mjs";
import { main as check } from "./cli/check.mjs";
import { main as diff } from "./cli/diff.mjs";
import { main as session, sessionCommands } from "./cli/session.mjs";
import { guideText } from "./shared/guide.mjs";

const usage = `Usage: pair guide [FILE]
       pair start [--session-dir PATH]
       pair ack|read|publish|progress|pause|complete|status --session-dir PATH [options]
       pair side-work add|update --session-dir PATH [options]
       pair build SOURCE.json OUTPUT.html
       pair diff BEFORE AFTER OUTPUT.json
       pair check [--codex-rules | STATE_DIR]`;

// The skill's one instruction prints guide/pair.md, and the next lines name
// the other guide files the same way.
async function guide([name]) {
  process.stdout.write(await guideText(name));
}
const commands = {
  build,
  diff,
  check,
  guide,
  ...Object.fromEntries(
    sessionCommands.map((name) => [name, (args) => session([name, ...args])]),
  ),
};

// Every command's error goes through one catch, so each starts with pair:
// and carries the Codex sandbox hint where the sandbox refused it.
const [command, ...args] = process.argv.slice(2);
if (Object.hasOwn(commands, command)) {
  await commands[command](args).catch((error) => {
    console.error(`pair: ${withSandboxHint(error.message)}`);
    process.exitCode = 1;
  });
} else {
  console.error(usage);
  process.exitCode = 1;
}
