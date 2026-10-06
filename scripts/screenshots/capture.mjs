import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPage } from "../../src/cli/build.mjs";
import { open } from "../../tests/support/browser.mjs";
import { hub } from "../../tests/support/hub.mjs";
import { watch } from "./failure.mjs";

const demo = fileURLToPath(new URL("../demo/", import.meta.url));
const themes = ["light", "dark"];
const desktop = { width: 1160, height: 760 };
const phone = { width: 390, height: 844 };
// A second session, whose round waits for the reviewer, turns the sessions
// button orange and adds its start and its waiting round to the bell.
const waiting = {
  name: "waiting-session",
  round: "1",
  title: "A second session waits for review",
  task: {
    title: "A second session waits for review",
    html: "<p>This session has a published page for the reviewer.</p>",
  },
  directory: demo,
  pages: [
    {
      id: "overview",
      title: "Overview",
      html: "<p>The reviewer can open this session from the session list.</p>",
    },
  ],
  agreements: [],
};

const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));

// Round N of the demo session: its name, title and task from plan.json, and
// its pages and agreements from round-N/pages.json.
async function loadRound(number) {
  const directory = path.join(demo, `round-${number}`);
  const { name, title, task } = await readJson(path.join(demo, "plan.json"));
  const { pages, agreements = [] } = await readJson(
    path.join(directory, "pages.json"),
  );
  return {
    name,
    round: String(number),
    title,
    task,
    directory,
    pages,
    agreements,
  };
}

// buildPage reads a page's file and css relative to the directory of the
// source path it is given, which is the round's directory.
const build = (round, page) =>
  buildPage(path.join(round.directory, "pages.json"), {
    name: round.name,
    round: round.round,
    title: round.title,
    page,
  });

// A demo agreement names its source as a round and a choice, or a round
// alone for that round's note, because the submission IDs exist only once
// the browser has sent the round's feedback.
function agreement({ source, ...entry }, sent) {
  const { id, groups } = sent[source.round].payload;
  const ref = source.choice
    ? {
        kind: "choice",
        submissionId: id,
        choiceId: Object.keys(groups.choices).find((key) =>
          key.endsWith(`/${source.choice}`),
        ),
      }
    : { kind: "note", submissionId: id, noteId: groups.notes[0].id };
  return { ...entry, sourceRefs: [ref] };
}

async function act(session, action, data) {
  const { code, body } = await session.action(action, data);
  if (code !== 200)
    throw new Error(`pair ${action}: ${body.error || `HTTP ${code}`}`);
  return body;
}

// Publishes Agreed with the round's page list, then the round's first
// `count` pages, each after pair progress --page, as an agent does.
async function publish(session, round, sent, count = round.pages.length) {
  const agreed = {
    id: "agreed",
    title: "Agreed so far",
    task: round.task,
    agreements: round.agreements.map((entry) => agreement(entry, sent)),
  };
  await act(session, "publish", {
    html: await build(round, agreed),
    pages: round.pages.map(({ id, title }) => ({ id, title })),
  });
  for (const page of round.pages.slice(0, count)) {
    await act(session, "progress", { start: [page.id] });
    await act(session, "publish", { html: await build(round, page) });
  }
}

// Waits for a condition in the page, and names the step when it times out.
export async function until(page, step, predicate, arg) {
  try {
    await page.waitForFunction(predicate, arg);
  } catch (error) {
    throw new Error(`${step}: ${error.message}`, { cause: error });
  }
}

// Waits until every code block, diagram, formula and chart on the shown
// page has rendered or shown its error. Then it refuses a visible renderer
// error.
export async function ready(page) {
  await until(page, "Rendering the page's figures", () =>
    [
      ...document.querySelectorAll(
        "#page-content :is([data-language], [data-diagram], [data-math], [data-chart])",
      ),
    ].every(
      (element) =>
        element.nextElementSibling?.matches(".renderer-error") ||
        element.querySelector(".shiki, .katex, svg, canvas"),
    ),
  );
  const errors = await page
    .locator(".renderer-error:visible")
    .allTextContents();
  if (errors.length)
    throw new Error(`A figure failed to render: ${errors.join("; ")}`);
}

// Loads the session's page with this ID afresh, because the frame reads the
// page from the address's hash only when it loads.
export async function load(page, url, id) {
  await page.goto("about:blank");
  await page.goto(`${url}#${id}`);
  await until(
    page,
    `Opening page ${id}`,
    (id) => document.getElementById("page-content")?.dataset.pageId === id,
    id,
  );
  await ready(page);
}

// The frame learns of the second session and of the agent's reply from a
// poll of the hub every 5 s, so a capture waits for both counts: the
// sessions badge's count of the second session, whose round waits for you,
// and the bell's lines for that session's start and round and the reply.
async function counted(page) {
  await until(
    page,
    "Counting the sessions and the notifications",
    () =>
      document.getElementById("sessions-count").textContent === "1" &&
      document.getElementById("bell-count").textContent === "3",
  );
}

// Takes one screenshot in each theme. The screenshot stops the frame's
// animations, so the same state always gives the same pixels.
export async function inThemes(page, clip) {
  // The pointer rests on the middle of the header's top edge, where no
  // control shows a hover state.
  await page.mouse.move(page.viewportSize().width / 2, 1);
  const shots = {};
  for (const theme of themes) {
    await page.emulateMedia({ colorScheme: theme });
    await until(
      page,
      `Switching to the ${theme} theme`,
      (theme) => document.documentElement.dataset.theme === theme,
      theme,
    );
    await ready(page);
    shots[theme] = await page.screenshot({ animations: "disabled", clip });
  }
  return shots;
}

// Scrolls the page's column until the element's top sits 6px under the
// header or, with `bottom`, until its bottom sits 54px above the window's
// bottom edge, clear of the floating comment button.
async function scrollTo(page, selector, { bottom = false } = {}) {
  await page.evaluate(
    ([selector, bottom]) => {
      const column = [
        document.querySelector("main"),
        document.querySelector(".app-body"),
      ].find((element) =>
        /auto|scroll/.test(getComputedStyle(element).overflowY),
      );
      const box = document.querySelector(selector).getBoundingClientRect();
      column.scrollTop += bottom
        ? box.bottom - (innerHeight - 54)
        : box.top - column.getBoundingClientRect().top - 6;
    },
    [selector, bottom],
  );
}

// Selects the words in the page's content, as a reader's drag does, and
// waits for the comment control to name the selection. A saved note redraws
// the page, and Shiki then replaces each code block's text, which empties a
// selection made in the block before then, so select waits for the page's
// figures first. Chrome fires no selectionchange for that emptying, and the
// control would keep naming the lost words, so the wait also checks the
// selected range.
export async function select(page, words) {
  await ready(page);
  await page.evaluate((words) => {
    const content = document.getElementById("page-content");
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let text = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement.closest("pair-thread, script, style")) continue;
      nodes.push({ node, start: text.length });
      text += node.data;
    }
    const at = text.indexOf(words);
    if (at < 0) throw new Error(`No text on the page reads: ${words}`);
    const point = (offset) => {
      const hit = nodes.findLast((item) => item.start <= offset);
      return [hit.node, offset - hit.start];
    };
    const range = document.createRange();
    range.setStart(...point(at));
    range.setEnd(...point(at + words.length - 1));
    range.setEnd(range.endContainer, range.endOffset + 1);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }, words);
  await until(
    page,
    `Selecting "${words}"`,
    (words) =>
      getSelection().rangeCount === 1 &&
      getSelection().getRangeAt(0).toString() === words &&
      document.getElementById("comment-here").dataset.on === "selection",
    words,
  );
}

// Opens the note dialog from the comment control, which names the selection
// or the chosen block, and types a note.
export async function writeNote(page, text) {
  await page.locator("#comment-here").click();
  await page.locator("#note-dialog[open]").waitFor();
  await page.locator("#note-text").fill(text);
}

// Sends the round's feedback with the header's Send feedback button and
// the Send popup's button, which keeps the popup's first choice, and
// returns the submission that pair read gives the agent.
async function send(page, session) {
  const response = page.waitForResponse((response) =>
    response.url().endsWith("/api/feedback"),
  );
  await page.locator("#submit").click();
  await page.locator("#send-dialog[open]").waitFor();
  await page.locator("#send-button").click();
  if (!(await response).ok())
    throw new Error(
      `The hub refused the feedback: ${await (await response).text()}`,
    );
  return (await act(session, "read")).event;
}

// The README's pair: the window, and beside it the phone scaled to the
// window's height, laid out as in the README's first screenshots. The sheet
// has one device pixel per CSS pixel, so the window keeps its pixels.
async function compose(browser, windowShot, phoneShot, theme) {
  const sheet = await browser.newPage({
    viewport: { width: 3222, height: 1664 },
    deviceScaleFactor: 1,
  });
  const src = (png) => `data:image/png;base64,${png.toString("base64")}`;
  const ground = theme === "light" ? "#e8e8ec" : "#16161a";
  const edge = theme === "light" ? "rgba(0,0,0,.12)" : "rgba(255,255,255,.14)";
  await sheet.setContent(`<style>
    html, body { margin: 0; background: ${ground}; }
    div { display: flex; gap: 56px; padding: 72px; align-items: flex-start; }
    img { display: block; height: 1520px; border-radius: 20px; box-shadow: 0 0 0 2px ${edge}, 0 12px 40px rgba(0,0,0,.18); }
    img + img { border-radius: 44px; }
  </style><div><img src="${src(windowShot)}"><img src="${src(phoneShot)}"></div>`);
  const png = await sheet.screenshot();
  await sheet.close();
  return png;
}

// Stages the demo session on a hub of its own, and returns each PNG by its
// path in the repository.
export async function stage(t, scratch) {
  const env = {
    XDG_STATE_HOME: path.join(scratch, "state"),
    XDG_CONFIG_HOME: path.join(scratch, "config"),
  };
  // buildPage and the hub read process.env too, so every path they derive
  // from it stays in the scratch directory.
  Object.assign(process.env, env);
  const h = await hub(t, env);
  const session = await h.session();
  const url = new URL(`${session.base}/`, h.server.origin).href;
  const sent = {};
  const images = new Map();
  const save = (name, shots) => {
    for (const theme of themes)
      images.set(`${name}-${theme}.png`, shots[theme]);
  };

  // Round 1: the reviewer chooses where a thread starts and notes what a
  // reply holds.
  await publish(session, await loadRound(1), sent);
  const page = watch(
    await open(t, "about:blank", { viewport: desktop, deviceScaleFactor: 2 }),
    "demo",
  );
  await load(page, url, "overview");
  // The bell's first poll marks every event it finds as seen, so the
  // second session starts after it.
  await page.locator("#bell").waitFor();
  await publish(await h.session({ start: true }), waiting, sent);
  await page
    .locator('[data-choice="start"] [data-value="note-dialog"]')
    .click();
  await select(page, "so a reply can show code, a diff or a diagram");
  await writeNote(
    page,
    "Yes, like a page. But never a decision or a question: those belong on a page.",
  );
  await page.locator("#note-save").click();
  sent[1] = await send(page, session);

  // Round 2: the reviewer chooses the first option, asks about it in a
  // thread, and the agent answers.
  await publish(session, await loadRound(2), sent);
  await load(page, url, "where-a-reply-appears");
  const decision = page.locator('[data-choice="answer"]');
  await decision.locator('[data-vd-layout="columns"]').click();
  await decision.locator('[data-value="under"]').click();
  await decision.locator(".vd-head h3").click();
  await until(
    page,
    "Commenting on the decision",
    () =>
      document.getElementById("comment-here").getAttribute("aria-label") ===
      "Comment on this decision",
  );
  await writeNote(page, "Does the agent stop what it's doing to answer?");
  const started = page.waitForResponse((response) =>
    response.url().endsWith("/api/threads"),
  );
  await page.locator("#note-thread").click();
  await started;
  const [thread] = (await session.status()).body.threads;
  await act(session, "reply", {
    note: thread.id,
    text: "It answers between its steps, then goes back to its work, so a reply can take a minute.",
  });
  await page.getByText("goes back to its work").waitFor();
  await counted(page);

  await scrollTo(page, "pair-thread", { bottom: true });
  await select(page, "top(document.getElementById(thread.target))");
  const windows = await inThemes(page);

  await writeNote(page, "Why does a named target come before the quote?");
  save("docs/assets/note-dialog", await inThemes(page));
  await page.keyboard.press("Escape");
  await page.locator("#note-dialog").waitFor({ state: "hidden" });

  await page.locator("#bell").click();
  await page.getByText("Agent replied on Where a reply appears").waitFor();
  save("docs/assets/bell", await inThemes(page));
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.activeElement.blur());

  await page.setViewportSize(phone);
  await page.evaluate(() => getSelection().removeAllRanges());
  await scrollTo(page, '[data-choice="answer"]');
  save("docs/assets/plan-phone", await inThemes(page));

  // Round 3: the reviewer sends round 2, and Agreed shows the progress card
  // while the agent writes the round's pages.
  sent[2] = await send(page, session);
  const third = await loadRound(3);
  await publish(session, third, sent, 1);
  await act(session, "progress", { start: [third.pages[1].id] });
  await act(session, "ack", { note: "Reading your thread replies" });
  await load(page, url, "agreed");
  await page.getByText("2 of 4 pages ready").waitFor();
  await counted(page);
  const phones = await inThemes(page);
  // The card with the page's side margins, and a margin above and below
  // that stops short of the page title.
  const card = await page.locator("#agent-activity").boundingBox();
  const title = await page.locator("#page-title").boundingBox();
  const margin = Math.min(card.x, card.y - (title.y + title.height));
  save(
    "docs/assets/progress-card",
    await inThemes(page, {
      x: 0,
      y: card.y - margin,
      width: phone.width,
      height: card.height + 2 * margin,
    }),
  );

  for (const theme of themes)
    images.set(
      `assets/pair-${theme}.png`,
      await compose(
        page.context().browser(),
        windows[theme],
        phones[theme],
        theme,
      ),
    );
  return images;
}
