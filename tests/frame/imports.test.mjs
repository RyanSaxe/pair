import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Node resolves the #frame/… and #shared/… names through imports in
// package.json, as the browser resolves them through the page's import map, so
// importing a module fails here on a missing export. The test skips
// app/boot.mjs, the one module that touches document when it loads.
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
