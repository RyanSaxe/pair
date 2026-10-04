import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { open } from "../../tests/support/browser.mjs";
import { hub, pairCli } from "../../tests/support/hub.mjs";
import { inThemes, load, select, until, writeNote } from "./capture.mjs";
import { composeIllustration, composeWork } from "./sheets.mjs";

const demo = fileURLToPath(new URL("../demo/illustration/", import.meta.url));
const desktop = { width: 880, height: 1200 };
const phone = { width: 390, height: 844 };
const title = "Retry a charge when the payment gateway times out";
const proposal = "idempotency-keys";
// The code line the reviewer starts a thread on, and the selections tried
// in order for the picture, until one leaves its Comment button over no
// words.
const line = "return await gateway.charge(order, { idempotencyKey });";
const selections = [line, "{ idempotencyKey }", "idempotencyKey });"];

// The words of the page that the frame's floating Comment button covers.
const covered = (page) =>
  page.evaluate(() => {
    const button = document
      .getElementById("comment-here")
      .getBoundingClientRect();
    const walker = document.createTreeWalker(
      document.getElementById("page-content"),
      NodeFilter.SHOW_TEXT,
    );
    const hits = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.data.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const box of range.getClientRects())
        if (
          box.right > button.left &&
          box.left < button.right &&
          box.bottom > button.top &&
          box.top < button.bottom
        )
          hits.push(node.data.trim());
    }
    return hits;
  });

async function refused(response, what) {
  if (!response.ok())
    throw new Error(`The hub refused ${what}: ${await response.text()}`);
  return response;
}

// Sends the round's feedback with the header's Send feedback button.
async function send(page) {
  const response = page.waitForResponse((r) =>
    r.url().endsWith("/api/feedback"),
  );
  await page.locator("#submit").click();
  await refused(await response, "the feedback");
}

// Stages a session with the pair command, as an agent runs it, and returns
// the README's illustration and work image in both themes. The terminal in
// the illustration shows what the commands printed in this run.
export async function illustrate(t, scratch) {
  const state = path.join(scratch, "state");
  const work = path.join(scratch, "work");
  await fs.mkdir(state, { recursive: true });
  await fs.cp(demo, path.join(work, "src"), { recursive: true });
  const env = {
    XDG_STATE_HOME: state,
    XDG_CONFIG_HOME: path.join(scratch, "config"),
    PAIR_WAKE: "off",
  };
  await hub(t, env);
  const agent = await pairCli(
    state,
    { ...env, PAIR_HUB_PORT: "0" },
    { cwd: work },
  );
  const transcript = [];
  const pair = async (...args) => {
    let result;
    try {
      result = await agent.output(...args);
    } catch (error) {
      throw new Error(
        `pair ${args[0]} failed:\n${error.stdout}${error.stderr}`.trim(),
        { cause: error },
      );
    }
    const text = `${result.stdout}${result.stderr}`;
    transcript.push({ args, text });
    return text;
  };
  const field = (text, name) => {
    const value = text.match(new RegExp(`^${name}\\s+(\\S+)$`, "m"))?.[1];
    if (!value) throw new Error(`pair start printed no ${name} line`);
    return value;
  };
  // Agreed with the page list, then each page after pair progress --page,
  // from the sources under src/ROUND.
  const round = async (dir, n, pages) => {
    await fs.mkdir(path.join(work, "out", n), { recursive: true });
    const publish = async (id, ...more) => {
      await pair("build", `src/${n}/${id}/${id}.json`, `out/${n}/${id}.html`);
      await pair(
        "publish",
        "--file",
        `out/${n}/${id}.html`,
        ...more,
        "--source",
        `src/${n}/${id}`,
        "--session-dir",
        dir,
      );
    };
    await publish("agreed", "--pages", `src/${n}/pages.json`);
    for (const id of pages) {
      await pair("progress", "--page", id, "--session-dir", dir);
      await publish(id);
    }
  };

  let doing = "starting the session";
  const images = new Map();
  try {
    const started = await pair("start", "--title", title);
    const dir = field(started, "Session");
    const url = field(started, "URL");
    await round(dir, "1", ["timeouts"]);
    const page = await open(t, "about:blank", {
      viewport: desktop,
      deviceScaleFactor: 2,
    });

    doing = "sending round 1";
    await load(page, url, "timeouts");
    await select(page, 'checkout shows "Payment failed"');
    await writeNote(
      page,
      "Plan a retry for timeouts. Leave declines as they are.",
    );
    await page.locator("#note-save").click();
    await send(page);
    await pair("read", "--session-dir", dir);

    doing = "starting a thread on round 2";
    await round(dir, "2", ["where-to-retry", "idempotency", "tests"]);
    await load(page, url, "where-to-retry");
    await page.locator('[data-choice="where"] [data-value="request"]').click();
    await select(page, "GatewayTimeout");
    await writeNote(page, "Does a connection reset count as a timeout?");
    await page.locator("#note-save").click();
    await select(page, line);
    await writeNote(page, "what if the gateway already charged?");
    const opened = page.waitForResponse((r) =>
      r.url().endsWith("/api/threads"),
    );
    await page.locator("#note-thread").click();
    const thread = (await (await refused(await opened, "the thread")).json())
      .thread?.id;
    if (!thread) throw new Error("The hub answered the thread with no ID");
    await pair("read", "--session-dir", dir, "--thread", thread);
    await pair(
      "reply",
      "--session-dir",
      dir,
      "--thread",
      thread,
      "--text",
      "Each retry sends the same idempotency key, so the gateway charges once.",
    );
    await pair(
      "propose",
      "--session-dir",
      dir,
      "--id",
      proposal,
      "--title",
      "Add idempotency keys to charges",
      "--delivers",
      "Each charge sends an Idempotency-Key built from the order ID.",
      "--changes",
      "src/payments/gateway.ts, src/payments/charge.ts and their tests",
      "--recommend",
      "sub-session",
      "--reason",
      "It changes only the payments client, so it can run beside this plan.",
      "--source",
      "From the Where to retry page",
      "--page",
      "2/where-to-retry",
    );

    doing = "taking the browser's screenshot";
    await load(page, url, "where-to-retry");
    await page.getByText("so the gateway charges once").waitFor();
    // The window ends 28px under the thread.
    const bottom = await page.evaluate(
      () =>
        document.querySelector("pair-thread").getBoundingClientRect().bottom,
    );
    await page.setViewportSize({
      width: desktop.width,
      height: Math.ceil((bottom + 28) / 8) * 8,
    });
    let clear = false;
    for (const words of selections) {
      await select(page, words);
      if (!(await covered(page)).length) {
        clear = true;
        break;
      }
    }
    if (!clear)
      throw new Error(
        `the Comment button covers words for each selection: ${selections.join(", ")}`,
      );
    const shots = { browser: await inThemes(page) };
    await page.evaluate(() => getSelection().removeAllRanges());

    doing = "taking the Work card's screenshot";
    await page.goto("about:blank");
    await page.goto(`${url}#work`);
    const card = page.locator("article.proposal-card").first();
    const start = card.getByRole("button", { name: "Start", exact: true });
    await start.waitFor();
    const cardBox = await card.boundingBox();
    const startBox = await start.boundingBox();
    const geometry = {
      cardWidth: cardBox.width,
      startY: (startBox.y + startBox.height / 2 - cardBox.y) / cardBox.height,
    };
    shots.card = await inThemes(page, cardBox);

    doing = "sending round 2";
    await load(page, url, "where-to-retry");
    await send(page);
    await pair("read", "--session-dir", dir);

    doing = "starting the card on a phone";
    await page.setViewportSize(phone);
    await page.goto("about:blank");
    await page.goto(`${url}#work`);
    await page.locator("#work-tab-proposed").click();
    await start.waitFor();
    shots.phoneWork = await inThemes(page);
    await start.click();
    await page.locator("#start-dialog[open]").waitFor();
    await page.locator('#start-dialog [data-where="sub-session"]').click();
    await page
      .locator("#start-message")
      .fill("Keep the key as order-ID, so a retry reuses it.");
    await page.evaluate(() => document.activeElement.blur());
    shots.phoneStart = await inThemes(page);
    const begun = page.waitForResponse((r) =>
      r.url().endsWith(`/api/proposals/${proposal}/start`),
    );
    await page.locator("#start-send").click();
    await refused(await begun, "Start");

    doing = "starting the sub-session";
    await pair("read", "--session-dir", dir);
    const child = await pair("start", "--from", dir, "--proposal", proposal);
    const subDir = field(child, "Session");
    const subUrl = field(child, "URL");
    await fs.mkdir(path.join(work, "out/sub/1"), { recursive: true });
    await pair(
      "build",
      "src/sub/1/agreed/agreed.json",
      "out/sub/1/agreed.html",
    );
    await pair(
      "publish",
      "--file",
      "out/sub/1/agreed.html",
      "--pages",
      "src/sub/1/pages.json",
      "--source",
      "src/sub/1/agreed",
      "--session-dir",
      subDir,
    );
    for (const [id, note] of [
      ["keys", "Building the key from the order ID in gateway.ts"],
      ["tests", "Writing a test that retries a timed-out charge"],
    ])
      await pair(
        "progress",
        "--page",
        id,
        "--note",
        note,
        "--session-dir",
        subDir,
      );

    doing = "taking the sub-session's screenshots";
    await load(page, subUrl, "agreed");
    await page.getByText(title).first().waitFor();
    // Each page's row on the progress card opens to show the agent's note.
    const rows = page.locator("#agent-activity button.activity-page");
    await until(
      page,
      "Listing the pages in progress",
      () =>
        document.querySelectorAll("#agent-activity button.activity-page")
          .length === 2,
    );
    for (const row of await rows.all()) await row.click();
    shots.phoneSub = await inThemes(page);
    await page.setViewportSize({ width: desktop.width, height: 600 });
    await load(page, subUrl, "agreed");
    await page.locator("#agent-activity").waitFor();
    shots.sub = await inThemes(page);

    doing = "composing the pictures";
    const browser = page.context().browser();
    for (const theme of ["light", "dark"]) {
      const shot = Object.fromEntries(
        Object.entries(shots).map(([name, both]) => [name, both[theme]]),
      );
      images.set(
        `assets/illustration-${theme}.png`,
        await composeIllustration(browser, theme, shot, transcript, geometry),
      );
      images.set(
        `assets/work-${theme}.png`,
        await composeWork(browser, theme, shot),
      );
    }
  } catch (error) {
    throw new Error(
      `The illustration failed while ${doing}: ${error.message}`,
      {
        cause: error,
      },
    );
  }
  return images;
}
