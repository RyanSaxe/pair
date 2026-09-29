import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Node resolves the #frame/… and #shared/… names through package.json, as
// the page's import map does, so a missing export fails here. boot.mjs is
// the one module that touches the document as it loads.
const frame = fileURLToPath(new URL("../../src/frame/", import.meta.url));

async function* modules(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* modules(file);
    else if (entry.name.endsWith(".mjs")) yield file;
  }
}

for await (const file of modules(frame)) {
  const name = path.relative(frame, file).split(path.sep).join("/");
  if (name !== "app/boot.mjs")
    test(`frame/${name} loads without a browser`, () =>
      import(pathToFileURL(file).href));
}
