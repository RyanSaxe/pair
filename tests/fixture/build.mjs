#!/usr/bin/env node
// Assemble all component examples into one local preview.
import fs from "node:fs/promises";
import path from "node:path";
import { fixtureHtml } from "../support/fixture.mjs";

const [output, ...extra] = process.argv.slice(2);
if (!output || extra.length) {
  console.error("Usage: node tests/fixture/build.mjs OUTPUT.html");
  process.exit(1);
}
await fs.writeFile(output, await fixtureHtml(), { flag: "wx", mode: 0o600 });
console.log(path.resolve(output));
