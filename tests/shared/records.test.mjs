import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assemble } from "../../src/build/assemble.mjs";
import { build } from "../../src/cli/build.mjs";
import { pageData, readPlanData } from "../../src/shared/records.mjs";
import { planData } from "../support/hub.mjs";

test("agreement authoring preserves rich content and rejects ambiguous records", async (t) => {
  const data = planData();
  const entry = {
    id: "errors",
    title: "Per-item errors",
    html: "<pre>Result[Prediction, Error]</pre>",
    source: "User selected per-item errors",
    href: "./example.1.html?target=errors#overview",
  };
  const parsed = readPlanData(await assemble({ ...data, agreements: [entry] }));
  assert.deepEqual(parsed.agreements, [entry]);
  for (const agreements of [
    [entry, entry],
    [{ ...entry, id: "bad id" }],
    [{ ...entry, state: "pending" }],
    [{ ...entry, change: "old" }],
    [{ ...entry, source: "" }],
    [{ ...entry, href: "javascript:alert(1)" }],
    [{ ...entry, href: "data:text/html,test" }],
    null,
  ])
    await assert.rejects(assemble({ ...data, agreements }));
  const duplicateAgreed = {
    ...data,
    pages: [
      ...data.pages,
      { id: "agreed", title: "Agreed", html: "Previous decision" },
    ],
  };
  await assert.rejects(assemble({ ...duplicateAgreed, agreements: [] }));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pair-agreement-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, "decision.html"), entry.html);
  const { html, ...metadata } = entry;
  const source = path.join(directory, "source.json");
  await fs.writeFile(
    source,
    JSON.stringify({
      name: data.name,
      round: data.round,
      title: data.title,
      page: {
        id: "agreed",
        title: "Agreed so far",
        task: { title: "The task", html: "<p>What the plan builds.</p>" },
        agreements: [{ ...metadata, file: "decision.html" }],
      },
    }),
  );
  assert.equal(pageData(await build(source)).page.agreements[0].html, html);
});

test("plan data parsing refuses a reserved page ID and preserves rich HTML", () => {
  const html = (data) =>
    `<script type="application/json" id="plan-data">${JSON.stringify(data)}</script>`;
  assert.equal(
    readPlanData(html(planData())).pages[0].html,
    "<p>Preserve one result per input.</p>",
  );
  const reserved = planData();
  reserved.pages[0].id = "feedback";
  assert.throws(() => readPlanData(html(reserved)), /reserved/);
});
