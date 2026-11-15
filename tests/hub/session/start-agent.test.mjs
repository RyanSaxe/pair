import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { hub, launchConfig, pairCli, planData } from "../../support/hub.mjs";

// The new session registers under the card's ID before it runs pair guide.
const prompt = (directory, id) =>
  `In your own shell, run pair register --name ${id} first. If another running session has that name, run pair register without --name. Run pair guide and follow what it prints. Then run pair start --from ${directory} --proposal ${id}.`;

test("with a launch script, Open a new agent session runs it in the folder where the holder ran pair start, and the new agent's pair start --from links the card", async (t) => {
  const { config, runs } = await launchConfig(t);
  const folder = path.join(config, "project");
  await fs.mkdir(folder);
  const h = await hub(t, { XDG_CONFIG_HOME: config });
  const home = path.join(h.home, "cli");
  await fs.mkdir(home);
  const cli = await pairCli(
    home,
    { XDG_STATE_HOME: h.home, PAIR_HUB_PORT: "0", XDG_CONFIG_HOME: config },
    { cwd: folder },
  );
  const started = await cli.start();
  const directory = started.sessionDir;
  await cli.run(
    "propose",
    ...["--session-dir", directory, "--id", "churn-export"],
    ...["--title", "Refresh the export", "--delivers", "The new schema."],
    ...["--recommend", "new-agent"],
  );
  const browser = (route, body) =>
    fetch(`${h.server.origin}/s/${started.sessionId}${route}`, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", Origin: h.server.origin },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }).then((response) => response.json());
  assert.equal((await browser("/api/status")).startAgent, true);
  const pressed = await browser("/api/proposals/churn-export/open-agent", {
    where: "new-agent",
  });
  assert.equal(pressed.launchError, undefined);
  // Each part of the command reaches the script as its own argument and
  // unchanged, also through PowerShell on Windows.
  assert.deepEqual(await runs(), [
    {
      cwd: folder,
      args: [
        folder,
        "claude",
        "--name",
        "churn-export",
        "--",
        prompt(directory, "churn-export"),
      ],
    },
  ]);
  const linked = await h.session({
    start: true,
    from: directory,
    proposal: "churn-export",
  });
  const status = await browser("/api/status");
  assert.equal(status.proposals[0].started.session.id, linked.id);
  assert.deepEqual(status.threads, []);
});

test("a launch script that fails leaves the card started with a new agent, as Copy command does, and returns the script's error", async (t) => {
  const launch = await launchConfig(t, {
    error: "no server running on /tmp/tmux-501/default",
  });
  const h = await hub(t, { XDG_CONFIG_HOME: launch.config });
  const a = await h.session({ start: true, folder: launch.config });
  assert.equal((await a.publish(planData())).code, 200);
  const added = await a.action("propose", {
    id: "churn-export",
    title: "Refresh the export",
    delivers: "The new schema.",
    recommend: "new-agent",
  });
  assert.equal(added.code, 200, added.body.error);
  const pressed = await a.request(
    `${a.base}/api/proposals/churn-export/open-agent`,
    { where: "new-agent" },
  );
  assert.equal(pressed.code, 200, pressed.body.error);
  assert.match(
    pressed.body.launchError,
    /exited with status 1: no server running on \/tmp\/tmux-501\/default$/,
  );
  const [card] = pressed.body.proposals;
  assert.equal(card.started.where, "new-agent");
  assert.equal(card.started.session, undefined);
});
