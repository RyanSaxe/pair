import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { hub, launchConfig, pairCli, planData } from "../../support/hub.mjs";

const card = {
  title: "Refresh the churn data export",
  delivers: "The export uses the September schema.",
  recommend: "new-agent",
};
// launching starts a hub with the launch script that launchConfig writes for
// options. The holder works in folder.
async function launching(t, options) {
  const launch = await launchConfig(t, options);
  const folder = path.join(launch.config, "project");
  await fs.mkdir(folder);
  const h = await hub(t, { XDG_CONFIG_HOME: launch.config });
  return { ...launch, h, folder };
}
async function withSession({ h }, options) {
  const a = await h.session(options);
  assert.equal((await a.publish(planData())).code, 200);
  const cards = async () => (await a.status()).body.proposals;
  const find = async (id) => (await cards()).find((item) => item.id === id);
  const reviewer = (id, action, body = {}) =>
    a.request(`${a.base}/api/proposals/${id}/${action}`, body);
  const write = (id) =>
    a.request(`${a.base}/api/proposals`, {
      id,
      title: "Dark receipts",
      delivers: "The logo disappears.",
      action: "start-agent",
      where: "new-agent",
    });
  return { a, cards, find, reviewer, write };
}
const prompt = (directory, id) =>
  `Run pair guide and follow what it prints. Then run pair start --from ${directory} --proposal ${id}.`;

test("Start agent runs the launch script in the folder where the holder ran pair start, and the new agent's pair start --from links the card", async (t) => {
  const launch = await launching(t);
  const { h, config, folder, runs } = launch;
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
    "--session-dir",
    directory,
    "--id",
    "churn-export",
    "--title",
    card.title,
    "--delivers",
    card.delivers,
    "--recommend",
    "new-agent",
  );
  const base = `/s/${started.sessionId}`;
  const browser = (route, body) =>
    fetch(h.server.origin + base + route, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Origin: h.server.origin,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }).then(async (response) => ({
      code: response.status,
      body: await response.json(),
    }));
  assert.equal((await browser("/api/status")).body.startAgent, true);
  const pressed = await browser("/api/proposals/churn-export/start-agent", {
    where: "new-agent",
    message: "Keep the header height.",
  });
  assert.equal(pressed.code, 200, pressed.body.error);
  const [run] = await runs();
  assert.equal(run.cwd, folder);
  // Each part of the command reaches the script as its own argument and
  // unchanged, also through PowerShell on Windows.
  const sessionId = run.args[5];
  assert.match(
    sessionId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  assert.deepEqual(run.args, [
    folder,
    "claude",
    "--name",
    "churn-export",
    "--session-id",
    sessionId,
    prompt(directory, "churn-export"),
  ]);
  const opened = pressed.body.proposals.find(
    (item) => item.id === "churn-export",
  );
  assert.equal(opened.started.where, "new-agent");
  assert.equal(opened.started.message, "Keep the header height.");
  const linked = await h.session({
    start: true,
    from: directory,
    proposal: "churn-export",
  });
  const [linkedCard] = (await browser("/api/status")).body.proposals;
  assert.equal(linkedCard.started.session.id, linked.id);
});

test("Start agent on a card that Copy command started runs the script without starting the card again, and a written card starts once the script succeeds", async (t) => {
  const launch = await launching(t);
  const { a, find, reviewer, write } = await withSession(launch, {
    start: true,
    folder: launch.folder,
  });
  assert.equal(
    (await a.action("propose", { ...card, id: "copied" })).code,
    200,
  );
  assert.equal(
    (await reviewer("copied", "start", { where: "new-agent" })).code,
    200,
  );
  const copied = await find("copied");
  const again = await reviewer("copied", "start-agent", {
    where: "new-agent",
  });
  assert.equal(again.code, 200, again.body.error);
  assert.deepEqual(await find("copied"), copied);
  const written = await write("written");
  assert.equal(written.code, 200, written.body.error);
  assert.equal((await find("written")).started.where, "new-agent");
  assert.deepEqual(
    (await launch.runs()).map((run) => run.args.at(-1)),
    [prompt(a.directory, "copied"), prompt(a.directory, "written")],
  );
});

test("a launch script that fails leaves the card proposed, saves no written card, and returns the script's error", async (t) => {
  const launch = await launching(t, {
    error: "no server running on /tmp/tmux-501/default",
  });
  const { a, cards, find, reviewer, write } = await withSession(launch, {
    start: true,
    folder: launch.folder,
  });
  assert.equal(
    (await a.action("propose", { ...card, id: "churn-export" })).code,
    200,
  );
  const pressed = await reviewer("churn-export", "start-agent", {
    where: "new-agent",
  });
  assert.equal(pressed.code, 502);
  assert.match(
    pressed.body.error,
    /exited with status 1: no server running on \/tmp\/tmux-501\/default$/,
  );
  assert.equal((await find("churn-export")).started, null);
  assert.equal((await write("written")).code, 502);
  assert.deepEqual(
    (await cards()).map((item) => item.id),
    ["churn-export"],
  );
});

test("the hub offers no Start agent and refuses it without an executable launch script or the holder's folder", async (t) => {
  // Windows has no executable bit, so a script there always runs.
  const notExecutable =
    process.platform === "win32"
      ? []
      : [
          {
            name: "a script that is not executable",
            mode: 0o644,
            error: /is not executable/,
          },
        ];
  const cases = [
    { name: "no script", script: false, error: /^No launch script at / },
    ...notExecutable,
    {
      name: "no folder",
      folder: false,
      error: /before pair recorded the folder/,
    },
  ];
  for (const { name, script, mode, folder = true, error } of cases) {
    const launch = await launching(t, { script, mode });
    const { a, find, reviewer } = await withSession(launch, {
      start: true,
      ...(folder ? { folder: launch.folder } : {}),
    });
    assert.equal(
      (await a.action("propose", { ...card, id: "churn-export" })).code,
      200,
    );
    assert.equal((await a.status()).body.startAgent, false, name);
    const pressed = await reviewer("churn-export", "start-agent", {
      where: "new-agent",
    });
    assert.match(pressed.body.error, error, name);
    assert.equal((await find("churn-export")).started, null, name);
    assert.deepEqual(await launch.runs(), [], name);
  }
});
