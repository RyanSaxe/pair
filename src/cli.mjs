#!/usr/bin/env node
import fs from "node:fs/promises";
import { withSandboxHint } from "../adapters/codex/rules.mjs";
import { main as build } from "./cli/build.mjs";
import { main as check } from "./cli/check.mjs";
import { main as diff } from "./cli/diff.mjs";
import { main as session, sessionCommands } from "./cli/session.mjs";
import { guideFile } from "./shared/guide.mjs";
import { settings } from "./shared/settings.mjs";

const usage = `Usage: pair guide
       pair start [--session-dir PATH]
       pair ack|read|publish|progress|pause|complete|status --session-dir PATH [options]
       pair build SOURCE.json OUTPUT.html
       pair diff BEFORE AFTER OUTPUT.json
       pair check [--codex-rules | STATE_DIR]`;

// The skill's one instruction. It prints guide/pair.md from the guide copy,
// whose links are absolute paths.
async function guide() {
  const file = await guideFile("pair.md", settings().root);
  process.stdout.write(await fs.readFile(file, "utf8"));
}
const tools = { build, diff, check, guide };

const [command, ...args] = process.argv.slice(2);
if (sessionCommands.includes(command)) {
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
