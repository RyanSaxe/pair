import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { rulesExist, rulesFile } from "../../adapters/codex/rules.mjs";
import { attach } from "../hub/client.mjs";
import { startHub } from "../hub/server.mjs";
import { detectWake, identify } from "../hub/wake.mjs";
import { pageData } from "../shared/records.mjs";
import { requireNode, settings } from "../shared/settings.mjs";
import { exists, read, requireValue } from "../shared/util.mjs";
import { usageError } from "./arguments.mjs";
import { components } from "./components.mjs";
import { rows } from "./output.mjs";
import { proposalText } from "./tags.mjs";

// fs.cp gives each copied directory its source's mode, and rm cannot empty
// a read-only directory, so the copy is made writable before it goes. A
// link is removed itself, never followed.
async function removeCopy(copy) {
  const stat = await fs.lstat(copy).catch(() => null);
  if (stat?.isDirectory()) {
    await fs.chmod(copy, 0o700).catch(() => {});
    const entries = await fs
      .readdir(copy, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries)
      if (entry.isDirectory()) await removeCopy(path.join(copy, entry.name));
  }
  await fs.rm(copy, { recursive: true, force: true });
}
// fs.cp points each copied link at the absolute path of its target. A link
// into the source, by the path given or its real path, is made relative
// again, so it resolves inside the copy after the source is gone. A link
// elsewhere keeps its target.
async function relinkInside(copy, roots, directory = copy) {
  const relink = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await relinkInside(copy, roots, file);
    if (!entry.isSymbolicLink()) continue;
    const target = await fs.readlink(file);
    const inside = roots
      .map((root) => path.relative(root, target))
      .find(
        (relative) =>
          relative !== ".." &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative),
      );
    if (inside !== undefined) relink.push([file, inside]);
  }
  if (!relink.length) return;
  // fs.cp has already given the directory its source's mode, which may be
  // read-only, so it is writable only while its links change.
  const { mode } = await fs.stat(directory);
  await fs.chmod(directory, mode | 0o700);
  try {
    for (const [file, inside] of relink) {
      await fs.unlink(file);
      await fs.symlink(
        path.relative(directory, path.join(copy, inside)) || ".",
        file,
      );
    }
  } finally {
    await fs.chmod(directory, mode & 0o7777);
  }
}
// The source a round was built from is kept beside its built file, so the
// next round starts from it after the temp directory is gone.
async function keepSource(sessionDir, source, html) {
  const record = pageData(html);
  const target = path.join(
    path.resolve(sessionDir),
    "src",
    record.round,
    record.page.id,
  );
  // A --source that is a link is copied as the directory it names.
  const given = path.resolve(source);
  const from = await fs.realpath(given);
  requireValue(
    (await fs.stat(from)).isDirectory(),
    `--source must be a directory, and ${source} is not`,
  );
  requireValue((await fs.readdir(from)).length, `--source ${source} is empty`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  // Making the target claims it, so two publishes of one page cannot both
  // copy. A kept source is never empty, so an empty target belongs to a
  // publish still copying, or to one that was stopped while it copied.
  try {
    await fs.mkdir(target);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const entries = await fs.readdir(target).catch(() => undefined);
    const stopped =
      entries?.length === 0
        ? " It is empty, so another publish of this page is still copying, or one was stopped while it copied. Run pair status: if the page is not published and no other publish is running, delete that directory and publish again."
        : "";
    throw new Error(
      `Source for round ${record.round} already exists at ${target}.${stopped}`,
    );
  }
  // The copy takes the target's place only once it is complete, so a copy
  // that fails leaves nothing for the retry to find.
  const partial = `${target}.partial-${crypto.randomUUID()}`;
  try {
    await fs.cp(from, partial, { recursive: true });
    await relinkInside(partial, [...new Set([from, given])]);
    // A read-only directory cannot be renamed on macOS.
    await fs.chmod(partial, ((await fs.stat(partial)).mode & 0o777) | 0o700);
    // Windows cannot rename a directory onto another, even an empty one, so
    // the empty target that claims the page goes first there.
    if (process.platform === "win32") await fs.rmdir(target);
    await fs.rename(partial, target);
  } catch (error) {
    await removeCopy(partial).catch(() => {});
    await fs.rmdir(target).catch(() => {});
    throw error;
  }
  return target;
}
// The session a command names, and request(), which sends it one action.
// status may come from an agent that cannot be woken, such as one the holder
// briefed, unless the session has to register with a new hub.
// status still names the agent when there is one, because a hub that runs
// older code answers status only for the holder.
export async function openSession(options, { anyAgent = false } = {}) {
  requireNode();
  const config = settings();
  const directory = path.resolve(options["session-dir"]);
  let wake = null;
  try {
    wake = detectWake();
  } catch (error) {
    if (!anyAgent) throw error;
  }
  const register = () => attach(directory, config, (wake ||= detectWake()));
  // Only pair start creates a session, so a mistyped path fails here instead
  // of starting a session outside sessions/ that no hub loads again.
  requireValue(
    await exists(path.join(directory, "status.json")),
    `No pair session at ${directory}. Check the path, or create a session with pair start.`,
  );
  const connectionFile = path.join(directory, "connection.json");
  if (!(await exists(connectionFile))) await register();
  let connection = await read(connectionFile);
  const checkConnection = () =>
    requireValue(
      /^http:\/\/127\.0\.0\.1:\d+$/.test(connection.origin),
      "Invalid connection origin",
    );
  checkConnection();
  // Whether the hub may have acted on the request. It did when it accepted
  // it, and it may have when a request reached it but no whole answer came
  // back, or it failed inside. A refused connection never reached it, and a
  // refusal says it did not act.
  let mayHaveActed = false;
  // Connecting failed, so the request never left: refused, or blocked by a
  // sandbox or the network.
  const unreached = new Set([
    "ECONNREFUSED",
    "EPERM",
    "EACCES",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "EADDRNOTAVAIL",
  ]);
  async function request(data, retry = true) {
    const reattach = async () => {
      await register();
      connection = await read(connectionFile);
      checkConnection();
      return request(data, false);
    };
    let response;
    try {
      response = await fetch(
        `${connection.origin}/agent/${connection.sessionId}/action`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${connection.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...data,
            sessionId: connection.sessionId,
            // The hub takes every command but status only from the
            // session's holder.
            agent: wake && identify(wake),
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
    } catch (error) {
      if (!unreached.has(error.cause?.code)) mayHaveActed = true;
      if (retry && error.name === "TypeError") return reattach();
      throw error;
    }
    let result;
    try {
      result = await response.json();
    } catch (error) {
      mayHaveActed = true;
      throw error;
    }
    if (retry && response.status === 404 && result.error === "Unknown session")
      return reattach();
    if (response.status >= 500) mayHaveActed = true;
    requireValue(
      response.ok,
      result.error || "Request failed",
      response.status,
    );
    mayHaveActed = true;
    requireValue(
      (result.status?.sessionId || result.sessionId) === connection.sessionId,
      "Helper identity changed; resume the intended session",
      409,
    );
    return result;
  }
  return {
    directory,
    request,
    url: () => `${connection.origin}/s/${connection.sessionId}/`,
    mayHaveActed: () => mayHaveActed,
  };
}

// pair start refuses under Codex until the allow rule exists, because
// without it Codex asks the user to approve every pair command.
const codexRefusal = (file) =>
  `pair start refuses under Codex until ${file} exists, because without it Codex asks for approval of every pair command. Ask the user whether pair may write that file. With their yes, run pair setup-codex outside the sandbox, then ask them to restart Codex, which reads its rules only when it starts. Run pair start again after the restart.`;

export async function start(options) {
  requireNode();
  const resuming = options["session-dir"] !== undefined;
  const from = options.from !== undefined;
  if (from && (resuming || options.title !== undefined))
    throw usageError(
      "start",
      "pair start --from takes no --title and no --session-dir. It creates a session with the proposal's title.",
    );
  if (from !== (options.proposal !== undefined))
    throw usageError(
      "start",
      from
        ? "pair start --from takes --proposal ID, the proposal the new session runs."
        : "pair start takes --proposal only with --from.",
    );
  if (resuming && options.title !== undefined)
    throw usageError(
      "start",
      "pair start takes --title only when it creates a session, not with --session-dir.",
    );
  if (!resuming && !from && !options.title?.trim())
    throw usageError(
      "start",
      "pair start requires --title TEXT when it creates a session.",
    );
  const config = settings();
  const wake = detectWake();
  if (wake.harness === "codex" && !(await rulesExist()))
    throw new Error(codexRefusal(rulesFile));
  const directory = resuming
    ? path.resolve(options["session-dir"])
    : path.join(config.sessions, crypto.randomUUID());
  const started = await attach(directory, config, wake, {
    start: true,
    ...(from
      ? { from: path.resolve(options.from), proposal: options.proposal }
      : resuming
        ? {}
        : { title: options.title.trim() }),
  });
  const card = started.proposal;
  return {
    next: started.next,
    // A hub of the previous release names no moment for a new session.
    moment: started.moment || (resuming ? undefined : "start"),
    data: [
      rows([
        ["Session", started.sessionDir],
        ["URL", started.url],
        ["Phone URL", started.hostUrl],
        ["Title", started.title],
        ["Parent", started.parent?.sessionDir],
        ["Proposal", card?.id],
        [
          "Plan",
          card?.plan &&
            `${path.join(started.parent.sessionDir, "plans", card.id, "src")}${path.sep}, one directory per page`,
        ],
      ]),
      card && proposalText(card, started.joined),
    ]
      .filter(Boolean)
      .join("\n\n"),
    json: started,
  };
}

export async function publish(options) {
  const session = await openSession(options);
  const html = await fs.readFile(path.resolve(options.file), "utf8");
  const action = { action: "publish", html };
  if (options.pages)
    action.pages = (await read(path.resolve(options.pages))).pages;
  if (options.source)
    action.source = await keepSource(session.directory, options.source, html);
  let result;
  try {
    result = await session.request(action);
  } catch (error) {
    if (!action.source) throw error;
    // A source kept for a publish the hub refused would block the retry. A
    // published page's source is what the next round starts from, so while
    // the hub may have published this one the copy stays.
    if (!session.mayHaveActed()) {
      await removeCopy(action.source);
      throw error;
    }
    // A timeout's error cannot take a longer message, so a new one does.
    throw new Error(
      `${error.message.replace(/(?<![.?!])$/, ".")} The hub may have published this page, so its source stays at ${action.source}. Run pair status: if the page is not published, delete that directory and publish again.`,
      { cause: error },
    );
  }
  const { page } = result;
  // The agent chooses each page's components from this list, which follows
  // every Agreed.
  const choosing = result.moment === "publish-agreed";
  return {
    next: result.next,
    moment: result.moment,
    data: [
      [
        `Published ${page.id} in round ${page.round}.`,
        `URL ${result.url}`,
        ...(result.roundComplete ? [`Round ${page.round} is complete.`] : []),
      ].join("\n"),
      ...(choosing ? [(await components()).data] : []),
    ].join("\n\n"),
    json: result,
  };
}

// pair plan copies --source into the session's plans/ directory, with a
// directory for each page of the plan, and the hub moves the copy beside the
// plan it attaches.
async function stagePlanSource(sessionDir, source, ids) {
  const given = path.resolve(source);
  const from = await fs.realpath(given);
  requireValue(
    (await fs.stat(from)).isDirectory(),
    `--source must be a directory, and ${source} is not`,
  );
  for (const id of ids)
    requireValue(
      (await fs.stat(path.join(from, id)).catch(() => null))?.isDirectory(),
      `--source ${source} has no directory ${id}. Keep each page's source in a directory named by the page's ID.`,
    );
  const copy = path.join(sessionDir, "plans", `.source-${crypto.randomUUID()}`);
  await fs.mkdir(path.dirname(copy), { recursive: true, mode: 0o700 });
  try {
    await fs.cp(from, copy, { recursive: true });
    await relinkInside(copy, [...new Set([from, given])]);
    await fs.chmod(copy, ((await fs.stat(copy)).mode & 0o777) | 0o700);
  } catch (error) {
    await removeCopy(copy).catch(() => {});
    throw error;
  }
  return copy;
}

export async function plan(options) {
  const session = await openSession(options, { anyAgent: true });
  const { pages } = await read(path.resolve(options.pages));
  const records = [];
  for (const file of options.file)
    records.push(pageData(await fs.readFile(path.resolve(file), "utf8")));
  const ids = Array.isArray(pages) ? pages.map((page) => page?.id) : [];
  const source = await stagePlanSource(
    session.directory,
    options.source,
    ids.filter((id) => typeof id === "string"),
  );
  let result;
  try {
    result = await session.request({
      action: "plan",
      proposal: options.proposal,
      rounds: options.rounds,
      pages,
      records,
      source,
    });
  } finally {
    // The hub moved the copy when it attached the plan.
    await removeCopy(source).catch(() => {});
  }
  const { proposal } = result;
  return {
    next: result.next,
    moment: "plan",
    data: [
      `${result.replaced ? "Replaced the plan of" : "Attached the plan to"} proposal ${proposal.id}, from ${roundsText(proposal.plan.rounds)}: ${proposal.plan.pages.map((page) => page.id).join(", ")}.`,
      `URL ${result.url}`,
    ].join("\n"),
    json: result,
  };
}
const roundsText = (rounds) =>
  /^\d+-\d+$/.test(rounds) ? `rounds ${rounds}` : `round ${rounds}`;

// The hub process, which pair start spawns. It also closes itself once no
// session has been live for a while.
export async function runHub() {
  requireNode();
  const hub = await startHub(settings());
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => hub.close());
  await hub.closed;
  process.exit(0);
}
