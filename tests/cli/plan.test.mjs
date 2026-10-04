import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { buildPage } from "../../src/cli/build.mjs";
import { hub, pairCli, planData } from "../support/hub.mjs";

// pair plan copies --source into the session before the hub sees the plan,
// so a plan the hub refuses must leave no copy behind, and an attached plan
// keeps the copy as its source.
test("pair plan keeps the plan's source, and a refused plan leaves no copy", async (t) => {
  const h = await hub(t);
  const home = path.join(h.home, "cli");
  await fs.mkdir(home);
  const cli = await pairCli(home, {
    XDG_STATE_HOME: h.home,
    PAIR_HUB_PORT: "0",
  });
  const session = await h.session({ cli });
  assert.equal((await session.publish(planData())).code, 200);
  const dir = ["--session-dir", session.directory];
  await cli.run(
    ...["propose", ...dir, "--id", "deck", "--title", "Build the deck"],
    ...["--delivers", "Twelve slides.", "--changes", "Only talks/q3/."],
    ...["--recommend", "here", "--reason", "It is one file."],
    ...["--source", "From the conversation"],
  );
  const source = path.join(home, "plan");
  const pages = [
    { id: "overview", title: "Overview" },
    { id: "steps", title: "Steps" },
  ];
  const files = [];
  for (const page of pages) {
    await fs.mkdir(path.join(source, page.id), { recursive: true });
    const html = `<p>${page.title} of the plan.</p>`;
    await fs.writeFile(path.join(source, page.id, `${page.id}.html`), html);
    const file = path.join(home, `${page.id}.html`);
    await fs.writeFile(
      file,
      await buildPage(path.join(source, page.id, `${page.id}.json`), {
        name: "example",
        round: "plan",
        title: "Example work",
        page: { ...page, html },
      }),
    );
    files.push("--file", file);
  }
  await fs.writeFile(
    path.join(source, "pages.json"),
    JSON.stringify({ pages }),
  );
  const plan = (rounds) =>
    cli.run(
      ...["plan", ...dir, "--proposal", "deck", "--rounds", rounds],
      ...["--pages", path.join(source, "pages.json"), "--source", source],
      ...files,
    );
  const plans = path.join(session.directory, "plans");
  await assert.rejects(plan("2"), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /This session has no round 2/);
    return true;
  });
  assert.deepEqual(await fs.readdir(plans), []);

  const output = await plan("1");
  assert.ok(
    output.endsWith(
      `\n\nAttached the plan to proposal deck, from round 1: overview, steps.\nURL ${session.info.url}plans/deck/\n`,
    ),
    output,
  );
  assert.deepEqual(await fs.readdir(plans), ["deck"]);
  assert.equal(
    await fs.readFile(
      path.join(plans, "deck", "src", "steps", "steps.html"),
      "utf8",
    ),
    "<p>Steps of the plan.</p>",
  );
});
