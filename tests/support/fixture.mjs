import "./env.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assemble } from "../../src/build/assemble.mjs";

const directory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixture",
);

// The component fixture as one page. env.mjs keeps the components a user
// keeps under $XDG_CONFIG_HOME/pair/components out of it.
export async function fixtureHtml() {
  const source = JSON.parse(
    await fs.readFile(path.join(directory, "fixture.json"), "utf8"),
  );
  const pages = await Promise.all(
    source.pages.map(async ({ file, ...page }) => ({
      ...page,
      html: await fs.readFile(path.join(directory, file), "utf8"),
    })),
  );
  const prototypes = await Promise.all(
    source.prototypes.map(async ({ file, ...prototype }) => ({
      ...prototype,
      html: await fs.readFile(path.join(directory, file), "utf8"),
    })),
  );
  return assemble({ ...source, pages, prototypes });
}
