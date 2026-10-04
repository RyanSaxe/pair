#!/usr/bin/env node
import { withSandboxHint } from "../adapters/codex/rules.mjs";
import { findCommand, helpText, overview, parse } from "./cli/arguments.mjs";
import { commands } from "./cli/commands.mjs";
import { print } from "./cli/output.mjs";
import { packageVersion } from "./shared/settings.mjs";

async function main(argv) {
  const [name] = argv;
  if (name === "--version") return console.log(packageVersion);
  if (name === "--help") return process.stdout.write(overview(commands));
  const command = findCommand(commands, argv);
  if (!command) {
    process.stderr.write(
      `${name ? `pair: no command ${name}.\n` : ""}${overview(commands)}`,
    );
    process.exitCode = 1;
    return;
  }
  // --help runs nothing else, whatever else the arguments contain.
  if (command.rest.includes("--help"))
    return process.stdout.write(helpText(command));
  const options = parse(command);
  const output = await command.entry.run(options);
  if (output) await print(output, { json: options.json, command: name });
}

// Every command's error goes through one catch, so each starts with pair:
// and carries the Codex sandbox hint where the sandbox refused it.
await main(process.argv.slice(2)).catch((error) => {
  console.error(`pair: ${withSandboxHint(error.message)}`);
  process.exitCode = 1;
});
