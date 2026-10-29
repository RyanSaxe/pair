import "../support/env.mjs";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { exec, exists, pair, root, task } from "../support/hub.mjs";

async function workDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pair-fields-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
// build runs pair build on the source and returns its stderr, or "" when the
// build succeeds.
async function build(directory, source) {
  const file = path.join(directory, "agreed.json");
  const output = path.join(directory, `${crypto.randomUUID()}.html`);
  await fs.writeFile(file, JSON.stringify(source));
  try {
    await exec(process.execPath, [pair, "build", file, output]);
    return "";
  } catch (error) {
    assert.equal(error.code, 1);
    assert.equal(await exists(output), false, "a refused build writes nothing");
    return error.stderr;
  }
}
const agreed = (page = {}, outer = {}) => ({
  name: "fields",
  round: "1",
  title: "Fields",
  ...outer,
  page: { id: "agreed", title: "Agreed so far", task, agreements: [], ...page },
});

// In a real session, the reviewer received rounds without a field, because
// Agreed's source put the field inside page and pair build ignored it.
test("pair build refuses a field it does not know and says where a misplaced one goes", async (t) => {
  const directory = await workDirectory(t);
  assert.match(
    await build(directory, agreed({ round: "1" })),
    /\bpage\.round\b.*\btop level\b/,
  );
  // A round ends only with the reviewer's feedback, so Agreed's source has no
  // offer field.
  assert.equal(
    await build(directory, agreed({}, { offer: "plan" })),
    "pair: agreed.json: offer is not a field of the source. A page source takes name, round, title and page, and Agreed's source also takes plan.\n",
  );
  assert.equal(await build(directory, agreed({}, { plan: true })), "");
  assert.match(
    await build(directory, agreed({}, { plan: "yes" })),
    /"plan" in Agreed's source is true or false/,
  );
  assert.match(
    await build(directory, {
      ...agreed({}, { plan: true }),
      page: { id: "policy", title: "Policy", html: "<p>Policy.</p>" },
    }),
    /plan is a field of Agreed's source only/,
  );
  const agreement = {
    id: "one",
    title: "One",
    html: "<p>One.</p>",
    sourceRefs: [{ kind: "conversation", text: "Said so.", quote: "x" }],
  };
  const refused = [
    [agreed({ color: "red" }), "page.color"],
    [agreed({}, { colour: "red" }), "colour"],
    [
      agreed({ agreements: [{ ...agreement, sourceRefs: undefined, why: 1 }] }),
      "page.agreements[0].why",
    ],
    [
      agreed({ agreements: [agreement] }),
      "page.agreements[0].sourceRefs[0].quote",
    ],
  ];
  for (const [source, field] of refused) {
    const refusal = await build(directory, source);
    assert(refusal.includes(field), `${field}: ${refusal}`);
  }
});

// An agent copies the guide's examples, so each one must build as written.
test("every page source in the guide's examples builds", async (t) => {
  const directory = await workDirectory(t);
  await fs.writeFile(path.join(directory, "policy.html"), "<p>Policy.</p>");
  await fs.writeFile(path.join(directory, "policy.css"), "p { margin: 0; }");
  await fs.writeFile(
    path.join(directory, "policy.mjs"),
    "export function setup() {}",
  );
  const guide = path.join(root, "guide");
  let count = 0;
  for (const name of await fs.readdir(guide, { recursive: true })) {
    if (!name.endsWith(".md")) continue;
    const text = await fs.readFile(path.join(guide, name), "utf8");
    for (const [, json] of text.matchAll(/```json\n([\s\S]*?)```/g)) {
      const source = JSON.parse(json);
      if (!source.page) continue;
      assert.equal(await build(directory, source), "", name);
      count++;
    }
  }
  assert(count >= 2, "the guide shows Agreed's source and a page's");
});
