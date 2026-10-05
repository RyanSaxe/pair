import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { assemble, pageScripts, pageStyles } from "../../build/assemble.mjs";
import { linkProblems } from "../../build/lint.mjs";
import { pageList, validPage } from "../../shared/records.mjs";
import { atomic, requireValue, timestamp } from "../../shared/util.mjs";

// A plan's pages assemble as one round of their own, and the frame shows a
// plan-data with a proposal as that proposal's plan.
const round = "plan";

// Plans: pair plan attaches the pages of a plan to a proposal's card. The
// hub keeps plans/ID/ with plan.html, the assembled file that the plan view
// shows and Download saves, pages.json, and src/ with each page's source.
// The card's plan fact says when the plan last changed and which rounds it
// came from.
export function plans(session) {
  const folder = path.join(session.directory, "plans");
  // --rounds names one round, or a range of numbered rounds such as 13-15,
  // and the session published every round it names.
  function planRounds(text) {
    const value = typeof text === "string" ? text.trim() : "";
    requireValue(
      value,
      "--rounds names the rounds the plan came from: one round, such as 4, or a range, such as 13-15",
    );
    const known = new Set(Object.keys(session.state.roundPages || {}));
    const range = value.match(/^(\d+)-(\d+)$/);
    if (known.has(value) || !range) {
      requireValue(known.has(value), `This session has no round ${value}`);
      return value;
    }
    const [first, last] = [Number(range[1]), Number(range[2])];
    requireValue(
      first < last,
      `--rounds ${value} runs backwards. Give the earlier round first.`,
    );
    for (let number = first; number <= last; number++)
      requireValue(
        known.has(String(number)),
        `This session has no round ${number}`,
      );
    return value;
  }
  // Each record is a page that pair build wrote, and the records follow
  // the page list in order.
  function planPages(data) {
    const pages = pageList(data.pages).map(({ id, title }) => ({ id, title }));
    const records = Array.isArray(data.records) ? data.records : [];
    requireValue(
      records.length === pages.length,
      `--pages lists ${pages.length} pages and ${records.length} --file ${records.length === 1 ? "was" : "were"} given. Give one --file for each page, in the same order.`,
    );
    const ids = new Set(pages.map(({ id }) => id));
    return records.map((record, index) => {
      const { page } = validPage(record);
      const slot = pages[index];
      requireValue(
        page.id === slot.id && page.title === slot.title,
        `--file ${index + 1} is page ${page.id}, "${page.title}", and --pages lists ${slot.id}, "${slot.title}" there`,
      );
      const bad = linkProblems(page.html, `page "${page.id}"`, ids);
      requireValue(!bad.length, bad.join("\n"));
      return page;
    });
  }
  // A source that pair plan copied into plans/ moves beside the plan.
  function stagedSource(source) {
    requireValue(
      typeof source === "string" &&
        path.dirname(path.resolve(source)) === folder,
      "The plan's source must be a copy in the session's plans directory",
    );
    return path.resolve(source);
  }
  // In a linked session, pair plan may name the proposal the session runs,
  // whose card is in the parent. The plan then comes from this session's
  // rounds and goes beside the parent's card.
  async function attachPages(data) {
    const owner = session.cardOwner(data.proposal, "pair plan");
    const card = owner
      ? await owner.exclusive(async () => owner.plannable(data.proposal))
      : session.plannable(data.proposal);
    const rounds = planRounds(data.rounds);
    const pages = planPages(data);
    const source = stagedSource(data.source);
    const html = await assemble(
      {
        name: card.id,
        round,
        title: card.title,
        proposal: card.id,
        pages: pages.map(({ id, title, html }) => ({ id, title, html })),
        prototypes: pages.flatMap((page) => page.prototypes || []),
      },
      { css: pageStyles(pages, round), js: pageScripts(pages, round) },
    ).catch((error) => {
      error.statusCode ||= 400;
      throw error;
    });
    // The new plan is written beside the old one and then takes its place,
    // so the plan view never shows half of each.
    const home = owner ? path.join(owner.directory, "plans") : folder;
    const target = path.join(home, card.id);
    const next = path.join(home, `.${card.id}-${crypto.randomUUID()}`);
    const old = `${next}-old`;
    await fs.mkdir(next, { recursive: true, mode: 0o700 });
    try {
      await atomic(path.join(next, "plan.html"), html);
      await atomic(path.join(next, "pages.json"), {
        pages: pages.map(({ id, title }) => ({ id, title })),
      });
      await fs.rename(source, path.join(next, "src"));
      await fs.rename(target, old).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      await fs.rename(next, target);
    } catch (error) {
      await fs.rm(next, { recursive: true, force: true });
      throw error;
    }
    await fs.rm(old, { recursive: true, force: true });
    const plan = {
      at: timestamp(),
      // The round of the session the plan's rounds are in, which names
      // itself when it is not the card's.
      round: session.state.current?.round ?? null,
      ...(owner ? { session: session.state.sessionId } : {}),
      rounds,
      pages: pages.map(({ id, title }) => ({ id, title })),
    };
    const proposal = owner
      ? await owner.exclusive(() => owner.attachPlan(card.id, plan))
      : await session.attachPlan(card.id, plan);
    return {
      proposal,
      replaced: Boolean(card.plan),
      url: `${session.origin}${owner ? owner.base : session.base}/plans/${encodeURIComponent(card.id)}/`,
    };
  }
  // The plan view and Download serve the file pair plan assembled.
  async function planFile(id) {
    const card = session.proposalItems().find((item) => item.id === id);
    requireValue(card?.plan, `No plan for proposal ${id}`, 404);
    return fs.readFile(path.join(folder, card.id, "plan.html"), "utf8");
  }
  return { attachPages, planFile };
}
