import fs from "node:fs/promises";
import path from "node:path";
import { atomic, read, requireValue, timestamp } from "../../shared/util.mjs";
import { wakeRunner } from "../wake.mjs";

// The states an agent moves an item to, in order. The reviewer starts and
// drops it.
const agentStates = ["working", "pr", "done"];
const limits = { title: 80, text: 400, source: 120 };
function words(data, name) {
  const value = typeof data[name] === "string" ? data[name].trim() : "";
  requireValue(
    value && value.length <= limits[name],
    `pair side-work add takes --${name}, text of at most ${limits[name]} characters`,
  );
  return value;
}
function link(url) {
  requireValue(
    typeof url === "string" && /^https?:\/\/\S+$/.test(url),
    "--url takes an http or https link",
  );
  return url;
}
// Work that turns up during a session but is not its task. The agent records
// an item, the reviewer starts it in parallel or drops it, and an agent
// reports each state after that. Each item is a file in side-work/, because
// its state changes after the round that showed it is published.
export async function sideWork(session) {
  const { directory, exclusive } = session;
  const folder = path.join(directory, "side-work");
  const items = [];
  try {
    for (const name of await fs.readdir(folder))
      if (name.endsWith(".json"))
        items.push(await read(path.join(folder, name)));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  items.sort((a, b) => Number(a.id) - Number(b.id));
  const find = (id) => {
    const item = items.find((entry) => entry.id === id);
    requireValue(item, `No side work ${id} in this session`, 404);
    return item;
  };
  async function save(item) {
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    await atomic(path.join(folder, `${item.id}.json`), item);
    const index = items.findIndex((entry) => entry.id === item.id);
    if (index < 0) items.push(item);
    else items[index] = item;
    return item;
  }
  const change = (item, patch) =>
    save({ ...item, ...patch, updatedAt: timestamp() });
  const listed = () => ({ sideWork: items });
  async function add(data) {
    const now = timestamp();
    return save({
      id: String(Math.max(0, ...items.map((item) => Number(item.id))) + 1),
      title: words(data, "title"),
      text: words(data, "text"),
      source: words(data, "source"),
      state: "recorded",
      addedAt: now,
      updatedAt: now,
    });
  }
  async function update(data) {
    const item = find(String(data.id));
    requireValue(
      agentStates.includes(data.state),
      "pair side-work update takes --state working, pr or done",
    );
    requireValue(
      item.state !== "recorded",
      `Side work ${item.id} has not been started. It starts when the reviewer presses Start in parallel on Agreed.`,
      409,
    );
    requireValue(
      item.state !== "dropped",
      `The reviewer dropped side work ${item.id}. Stop working on it.`,
      409,
    );
    requireValue(item.state !== "done", `Side work ${item.id} is done.`, 409);
    // An item moves to the next state, and repeating its state lets the agent
    // correct the link.
    const next = agentStates[agentStates.indexOf(item.state) + 1];
    requireValue(
      data.state === item.state || data.state === next,
      `Side work ${item.id} is in state ${item.state}, so the next update is --state ${next}.`,
      409,
    );
    const url = data.url === undefined ? item.url : link(data.url);
    requireValue(
      data.state !== "pr" || url,
      "--state pr takes --url with the pull request's link",
    );
    const changed = await change(item, {
      state: data.state,
      ...(url ? { url } : {}),
    });
    // The notification center announces the pull request once, and a
    // corrected link changes that announcement.
    const target = `side-work-${item.id}`;
    if (data.state === "pr" && item.state !== "pr")
      await session.addActivity({
        kind: "side-work",
        name: item.title,
        url,
        page: "agreed",
        target,
      });
    else if (data.state === "pr" && url !== item.url)
      await session.reviseActivity(
        (event) => event.kind === "side-work" && event.target === target,
        { url },
      );
    return changed;
  }
  // pair side-work, from any agent: the holder, or an agent it briefed to do
  // the work.
  async function recordSideWork(data) {
    requireValue(
      ["add", "update"].includes(data.change),
      "pair side-work takes add or update",
    );
    const item = await (data.change === "add" ? add(data) : update(data));
    return {
      sessionId: session.state.sessionId,
      item,
      ...(item.state === "pr"
        ? {
            next: `Run pair side-work update ${item.id} --state done --session-dir ${directory} after the pull request is merged.`,
          }
        : {}),
    };
  }
  // Runs after the reviewer's request is answered, as the wake after a
  // submission does. When the wake fails, the item is Recorded again, so
  // the reviewer can start it again.
  async function wakeFor(id) {
    const item = find(id);
    const line = `pair: side work "${item.title}" was started in parallel on session ${directory}. Do it apart from the session's own work: in a separate git worktree, on its own branch from the session's branch, done by you or by an agent you brief with the context it needs, ending in a pull request into the session's branch. When the session has no branch of its own in the repository you change, branch from that repository's default branch and open the pull request into it. Report each change with pair side-work update ${item.id}, then go back to what you were doing.`;
    let wake;
    try {
      requireValue(session.wake, "The session has no agent to wake");
      await wakeRunner(session.wake, line, session.config);
      wake = { at: timestamp(), ok: true };
    } catch (error) {
      wake = { at: timestamp(), ok: false, reason: error.message };
    }
    const current = find(id);
    await change(current, {
      wake,
      ...(!wake.ok && current.state === "started" ? { state: "recorded" } : {}),
    });
  }
  const open = () =>
    requireValue(
      session.state.stage !== "complete",
      "This session is closed",
      409,
    );
  async function startSideWork(id) {
    open();
    const item = find(id);
    requireValue(
      item.state === "recorded",
      item.state === "dropped"
        ? `Side work ${id} was dropped`
        : `Side work ${id} was already started`,
      409,
    );
    await change(item, { state: "started", wake: null });
    setTimeout(() => exclusive(() => wakeFor(id)), 0);
    return listed();
  }
  // Drop works at any state, and a second Drop changes nothing.
  async function dropSideWork(id) {
    open();
    const item = find(id);
    if (item.state !== "dropped") await change(item, { state: "dropped" });
    return listed();
  }
  return {
    sideWorkItems: () => items,
    recordSideWork,
    startSideWork,
    dropSideWork,
  };
}
