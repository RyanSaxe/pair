import { drawsBlock, wordsToMark } from "#frame/search/rows.mjs";

/* The modal's side of the preview: the iframe with the one document that stays
   loaded, and the page records it draws from. A page's record can be megabytes
   when it holds images, so only the last few stay in memory. */
const RECORDS_KEPT = 24;
// The selection can move faster than a page's record arrives, so a result
// draws once it has been selected for a moment.
const REST_MS = 60;
// On a slow connection, the result's words show until its block arrives.
const WORDS_AFTER_MS = 250;

export function createPreview({ frame, onWords, onDrawn, onMiss, onKey }) {
  let ready = null;
  const pageSets = new Map();
  const records = new Map();
  let restTimer = 0;
  let wordsTimer = 0;
  let turn = 0;

  function load() {
    ready ||= new Promise((resolve) => {
      frame.addEventListener(
        "load",
        async () => {
          const win = frame.contentWindow;
          while (!win.pairPreview)
            await new Promise((done) => setTimeout(done, 20));
          win.addEventListener("keydown", onKey);
          resolve(win);
        },
        { once: true },
      );
      frame.src = "/preview";
    });
    return ready;
  }

  function record(row) {
    const api = `/s/${row.session}/api`;
    const key = `${row.session}|${row.round}|${row.page}`;
    if (!records.has(key)) {
      const setKey = `${row.session}|${row.round}`;
      if (!pageSets.has(setKey))
        pageSets.set(
          setKey,
          fetch(`${api}/page-set?round=${encodeURIComponent(row.round)}`).then(
            (reply) => reply.json(),
          ),
        );
      records.set(
        key,
        pageSets.get(setKey).then(async (set) => {
          const slot = set.pages.find((item) => item.id === row.page);
          const reply = await fetch(
            `${api}/page?round=${encodeURIComponent(row.round)}&id=${encodeURIComponent(row.page)}&version=${slot.version}`,
          );
          if (!reply.ok) throw Error("Could not load this page.");
          const { page } = await reply.json();
          return { page, version: slot.version };
        }),
      );
      records.get(key).catch(() => records.delete(key));
      if (records.size > RECORDS_KEPT)
        records.delete(records.keys().next().value);
    }
    return records.get(key);
  }

  async function draw(row, query, mine) {
    clearTimeout(wordsTimer);
    wordsTimer = setTimeout(
      () => mine === turn && onWords(row),
      WORDS_AFTER_MS,
    );
    try {
      const [{ page, version }, win] = await Promise.all([record(row), load()]);
      if (mine !== turn) return;
      await win.pairPreview.draw({
        key: `${row.session}|${row.round}|${row.page}|${row.block}|${row.item}`,
        page,
        round: row.round,
        version,
        block: row.block,
        item: row.type === "alignment" ? row.item : null,
        heading: row.type !== "page title",
        said:
          row.kind === "threads"
            ? {
                label: `${row.from === "reviewer" ? "You" : "Agent"} wrote, on this block`,
                text: row.text,
              }
            : null,
        words: wordsToMark(row, query),
        report: ({ found, settled }) => {
          if (mine === turn) onMiss(row, !found && settled && query.trim());
        },
      });
      if (mine !== turn) return;
      clearTimeout(wordsTimer);
      onDrawn(row);
    } catch {
      clearTimeout(wordsTimer);
      if (mine === turn) onWords(row);
    }
  }

  function show(row, query, { now = false } = {}) {
    clearTimeout(restTimer);
    clearTimeout(wordsTimer);
    const mine = ++turn;
    if (!row) return onWords(null);
    if (!drawsBlock(row)) return onWords(row);
    if (now) void draw(row, query, mine);
    else restTimer = setTimeout(() => draw(row, query, mine), REST_MS);
  }

  return { load, show };
}
