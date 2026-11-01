import fs from "node:fs/promises";
import path from "node:path";
import { atomic } from "../../shared/util.mjs";
import {
  agreedDocs,
  draftDocs,
  feedbackDocs,
  pageDocs,
  proposalDocs,
  threadDocs,
  titleDocs,
} from "./extract.mjs";
import { prepare, scoreDoc } from "./matcher.mjs";

/* The store keeps each session's search text in memory, and a cache of it in
   SESSION/search.jsonl, so a hub start reads only the files that changed. A
   cache entry counts only while its file's modified time and size and the
   extractor's version match, so it cannot go stale. Raise VERSION when
   extract.mjs changes what it reads. */
const VERSION = 2;
const CACHE = "search.jsonl";
export const KINDS = [
  "pages",
  "threads",
  "notes",
  "answers",
  "proposals",
  "agreed",
];
// Below this many results, the search adds partial rows and fuzzy matches.
const FEW_RESULTS = 30;
export const DEFAULT_LIMIT = 60;
const ONE_LETTER_LIMIT = 20;
// A row shows the words around its match, and its full text is the block's own.
// A note or message has no block to draw, so its preview needs its words.
const BLOCK_CLIP = 600;
const WORDS_CLIP = 8000;
// The matcher's recency bonus is per RECENCY_UNIT_MS of age.
const RECENCY_UNIT_MS = 35 * 24 * 60 * 60 * 1000;

const PLACE_NAMES = {
  agreed: "Agreed so far",
  work: "Work",
  feedback: "Review",
};

const roundNumber = (round) => Number(round) || 0;
const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const list = (directory) =>
  fs.readdir(directory).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });

// sources() lists every file search reads in one session, and how to read each
// one. Nothing here reads connection.json or wake.json, which hold secrets.
async function sources(directory, status) {
  const found = [];
  const add = (file, read) => found.push({ file, read });
  add("status.json", (record) => titleDocs(record));
  for (const [round, set] of Object.entries(status.roundPages ?? {})) {
    const paged = (name) => path.join("pages", round, path.basename(name));
    if (set.agreed)
      add(paged(set.agreed), (record, at) =>
        agreedDocs(record.page, round, at),
      );
    for (const slot of set.pages ?? [])
      if (slot.recordPath)
        add(paged(slot.recordPath), (record, at) =>
          pageDocs(record.page, round, at),
        );
  }
  for (const [folder, read] of [
    ["threads", threadDocs],
    ["feedback", feedbackDocs],
    ["proposals", proposalDocs],
  ])
    for (const name of await list(path.join(directory, folder)))
      if (name.endsWith(".json")) add(path.join(folder, name), read);
  add("draft.json", (record, at) => draftDocs(record, at));
  return found;
}

// Copies across rounds become one document at the newest round, told apart by
// exact comparison, and every other round goes in its also list. A thread
// message or a note is its own document even when its words repeat.
function grouped(entries) {
  const groups = new Map();
  for (const doc of entries) {
    const owned = doc.kind !== "pages" && doc.kind !== "agreed";
    const key = [
      doc.kind,
      owned ? doc.item : "",
      doc.type === "alignment" ? doc.item : "",
      // Two pages can share a title, and each opens its own page.
      doc.type === "page title" ? doc.page : "",
      doc.heading,
      doc.text,
      doc.attrs ?? "",
    ].join("\0");
    const seen = groups.get(key);
    if (!seen) {
      groups.set(key, { ...doc, also: [] });
      continue;
    }
    if (roundNumber(doc.round) > roundNumber(seen.round)) {
      const also = [...seen.also, seen.round];
      groups.set(key, { ...doc, also });
    } else if (doc.round !== seen.round) seen.also.push(doc.round);
  }
  return [...groups.values()];
}

function ready(doc, id) {
  return {
    ...doc,
    session: id,
    also: [...new Set(doc.also)].sort(
      (a, b) => roundNumber(a) - roundNumber(b),
    ),
    at: doc.at / RECENCY_UNIT_MS,
  };
}

function clip(doc, ranges) {
  const limit = Number.isInteger(doc.block) ? BLOCK_CLIP : WORDS_CLIP;
  if (doc.text.length <= limit) return { text: doc.text, ranges };
  const near = Math.max(0, (ranges[0]?.[0] ?? 0) - 120);
  const start = near && doc.text.indexOf(" ", near) + 1;
  const end = start + limit;
  return {
    text: doc.text.slice(start, end),
    ranges: ranges
      .filter(([from, to]) => from >= start && to <= end)
      .map(([from, to]) => [from - start, to - start]),
    clipped: true,
  };
}

// A block with no words on it shows the words of its attributes.
const shown = (doc, { textRanges = [], attrRanges = [] }) =>
  doc.text
    ? clip(doc, textRanges)
    : clip({ ...doc, text: doc.attrs ?? "" }, attrRanges);

// When few blocks have every word, a block with all but one word counts, and so
// does a page whose blocks have every word between them.
function partialRows(query, docs) {
  const parts = query.trim().split(/\s+/);
  if (parts.length < 2) return [];
  const found = new Map();
  parts.forEach((part, index) => {
    const prepared = prepare(part);
    if (!prepared) return;
    for (const doc of docs) {
      const hit = scoreDoc(prepared, doc);
      if (!hit) continue;
      let entry = found.get(doc);
      if (!entry)
        found.set(
          doc,
          (entry = {
            doc,
            words: new Set(),
            score: 0,
            textRanges: [],
            headingRanges: [],
            attrRanges: [],
          }),
        );
      entry.words.add(index);
      entry.score += hit.score;
      entry.textRanges.push(...hit.textRanges);
      entry.headingRanges.push(...hit.headingRanges);
      entry.attrRanges.push(...hit.attrRanges);
    }
  });
  const tidy = (ranges) => {
    const sorted = ranges.sort((a, b) => a[0] - b[0]);
    return sorted.filter(
      (range, index) => index === 0 || range[0] >= sorted[index - 1][1],
    );
  };
  const pages = new Map();
  const rows = [];
  for (const entry of found.values()) {
    // Each word's score includes the recency bonus, so a row keeps the mean to
    // stay on the scale of a block with every word.
    entry.score /= entry.words.size;
    entry.textRanges = tidy(entry.textRanges);
    entry.headingRanges = tidy(entry.headingRanges);
    entry.attrRanges = tidy(entry.attrRanges);
    if (parts.length >= 3 && entry.words.size === parts.length - 1)
      rows.push({
        ...entry,
        score: entry.score - 1000,
        partial: `Has ${entry.words.size} of ${parts.length} words`,
      });
    const { session, round, page } = entry.doc;
    const key = `${session}|${round}|${page}`;
    let holder = pages.get(key);
    if (!holder) pages.set(key, (holder = { words: new Set(), best: entry }));
    for (const word of entry.words) holder.words.add(word);
    if (entry.words.size > holder.best.words.size) holder.best = entry;
  }
  for (const holder of pages.values())
    if (
      holder.words.size === parts.length &&
      !rows.some((row) => row.doc === holder.best.doc)
    )
      rows.push({
        ...holder.best,
        score: holder.best.score - 2000,
        partial: "All words on this page",
      });
  return rows;
}

export function searchStore({ log = () => {} } = {}) {
  const sessions = new Map();
  let pendingLoads = 0;
  let closed = false;
  let queue = Promise.resolve();

  async function readFiles(entry) {
    const status = await readJson(path.join(entry.directory, "status.json"));
    const files = new Map();
    let wrote = false;
    for (const { file, read } of await sources(entry.directory, status)) {
      if (closed) return;
      const full = path.join(entry.directory, file);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat) continue;
      const known = entry.files.get(file);
      if (known?.mtimeMs === stat.mtimeMs && known.size === stat.size) {
        files.set(file, known);
        continue;
      }
      wrote = true;
      let docs = [];
      try {
        docs = read(await readJson(full), stat.mtimeMs);
      } catch (error) {
        log(`search skipped ${full}: ${error.message}`);
      }
      files.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, docs });
    }
    const removed = [...entry.files.keys()].some((file) => !files.has(file));
    entry.files = files;
    entry.title = status.title || status.current?.title || "New session";
    entry.latest = Object.keys(status.roundPages ?? {}).reduce(
      (latest, round) =>
        roundNumber(round) > roundNumber(latest) ? round : latest,
      "0",
    );
    entry.docs = grouped([...files.values()].flatMap((f) => f.docs)).map(
      (doc) => ready(doc, entry.id),
    );
    entry.pageTitles = new Map();
    for (const doc of entry.docs)
      if (doc.type === "page title")
        for (const round of [doc.round, ...doc.also])
          entry.pageTitles.set(`${round}/${doc.page}`, doc.heading);
    if (wrote || removed) void writeCache(entry);
  }

  async function readCache(entry) {
    let text;
    try {
      text = await fs.readFile(path.join(entry.directory, CACHE), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    const [head, ...lines] = text.split("\n");
    try {
      if (JSON.parse(head).version !== VERSION) return;
      for (const line of lines) {
        if (!line) continue;
        const { file, mtimeMs, size, docs } = JSON.parse(line);
        entry.files.set(file, { mtimeMs, size, docs });
      }
    } catch (error) {
      entry.files.clear();
      log(`search cache of ${entry.id} ignored: ${error.message}`);
    }
  }

  function writeCache(entry) {
    entry.writing = entry.writing
      .then(async () => {
        if (closed) return;
        const lines = [JSON.stringify({ version: VERSION })];
        for (const [file, { mtimeMs, size, docs }] of entry.files)
          lines.push(JSON.stringify({ file, mtimeMs, size, docs }));
        await atomic(
          path.join(entry.directory, CACHE),
          `${lines.join("\n")}\n`,
        );
      })
      .catch((error) =>
        log(`search cache of ${entry.id} not written: ${error.message}`),
      );
    return entry.writing;
  }

  // One read at a time for each session. A write that lands during a read marks
  // the session changed again, so the next search reads it once more.
  function refresh(entry) {
    entry.reading ||= (async () => {
      try {
        while (entry.changed && !closed) {
          entry.changed = false;
          await readFiles(entry);
        }
      } catch (error) {
        log(`search could not read ${entry.id}: ${error.message}`);
      } finally {
        entry.reading = null;
      }
    })();
    return entry.reading;
  }

  // The first read of each session runs in the background, one session at a
  // time, so a hub start never holds up a request.
  function add(id, directory) {
    const entry = {
      id,
      directory,
      title: "",
      latest: "0",
      files: new Map(),
      docs: [],
      pageTitles: new Map(),
      changed: true,
      loaded: false,
      reading: null,
      writing: Promise.resolve(),
    };
    sessions.set(id, entry);
    pendingLoads++;
    queue = queue.then(async () => {
      try {
        if (closed) return;
        await readCache(entry);
        await refresh(entry);
      } catch (error) {
        log(`search could not load ${id}: ${error.message}`);
      } finally {
        entry.loaded = true;
        pendingLoads--;
      }
    });
    return queue;
  }

  function markChanged(id) {
    const entry = sessions.get(id);
    if (entry) entry.changed = true;
  }

  const inRound = (doc, round, entry) => {
    if (!round) return true;
    const wanted = round === "latest" ? entry.latest : round;
    return doc.round === wanted || doc.also.includes(wanted);
  };

  function scan({ query, session, round, kinds, here, limit }) {
    const prepared = prepare(query);
    const counts = Object.fromEntries(KINDS.map((kind) => [kind, 0]));
    const hits = [];
    const inScope = [];
    let total = 0;
    let onBlocks = 0;
    for (const entry of sessions.values()) {
      if (session && entry.id !== session) continue;
      for (const doc of entry.docs) {
        if (!inRound(doc, round, entry)) continue;
        // With nothing typed, the list shows the newest things that have words.
        if (!prepared && !doc.text && !doc.attrs) continue;
        doc.here = doc.session === here;
        const hit = prepared ? scoreDoc(prepared, doc) : { score: doc.at };
        if (kinds.size === 0 || kinds.has(doc.kind)) inScope.push(doc);
        if (!hit) continue;
        counts[doc.kind]++;
        if (kinds.size && !kinds.has(doc.kind)) continue;
        total++;
        if (!hit.inAttrs) onBlocks++;
        hits.push({ doc, ...hit });
      }
    }
    if (prepared && onBlocks < FEW_RESULTS) {
      const already = new Set(hits.map((hit) => hit.doc));
      for (const row of partialRows(
        query,
        inScope.filter((doc) => !already.has(doc)),
      )) {
        counts[row.doc.kind]++;
        total++;
        hits.push(row);
      }
    }
    hits.sort((a, b) => b.score - a.score);
    const oneLetter = query.trim().length === 1;
    return {
      hits: hits.slice(0, oneLetter ? ONE_LETTER_LIMIT : limit),
      total,
      counts,
    };
  }

  const titleOf = (doc, entry) =>
    PLACE_NAMES[doc.page] ??
    entry.pageTitles.get(`${doc.round}/${doc.page}`) ??
    null;

  function row(hit) {
    const { doc } = hit;
    const entry = sessions.get(doc.session);
    return {
      session: doc.session,
      sessionTitle: entry.title,
      round: doc.round,
      page: doc.page,
      pageTitle: titleOf(doc, entry),
      block: doc.block,
      item: doc.item,
      kind: doc.kind,
      type: doc.type,
      heading: doc.heading,
      ...shown(doc, hit),
      headingRanges: hit.headingRanges ?? [],
      also: doc.also.filter((round) => round !== doc.round),
      partial: hit.partial ?? null,
      ...(doc.from ? { from: doc.from } : {}),
      ...(doc.code ? { code: true } : {}),
      ...(doc.draft ? { draft: true } : {}),
    };
  }

  // When a search finds nothing, wider says which filter to loosen first: every
  // kind, then all rounds, then all sessions. It only names a step that finds
  // something.
  function wider(options) {
    const steps = [
      ["kinds", { kinds: new Set() }],
      ["rounds", { kinds: new Set(), round: null }],
      ["sessions", { kinds: new Set(), round: null, session: null }],
    ];
    for (const [filter, change] of steps) {
      if (filter === "kinds" && !options.kinds.size) continue;
      if (filter === "rounds" && !options.round) continue;
      if (filter === "sessions" && !options.session) continue;
      const { total } = scan({ ...options, ...change });
      if (total) return { filter, total };
    }
    return null;
  }

  async function search({
    query = "",
    session = null,
    round = null,
    kinds = [],
    here = null,
    limit = DEFAULT_LIMIT,
  }) {
    const started = performance.now();
    await Promise.all(
      [...sessions.values()]
        .filter((entry) => entry.loaded && (entry.changed || entry.reading))
        .map(refresh),
    );
    const options = {
      query,
      session,
      round,
      kinds: new Set(kinds),
      here,
      limit,
    };
    const { hits, total, counts } = scan(options);
    return {
      results: hits.map(row),
      total,
      counts,
      ms: Math.round(performance.now() - started),
      ...(total === 0 && prepare(query) ? { wider: wider(options) } : {}),
      ...(pendingLoads ? { loading: true } : {}),
    };
  }

  async function close() {
    closed = true;
    await queue;
    await Promise.all(
      [...sessions.values()].flatMap((entry) => [entry.reading, entry.writing]),
    );
  }

  return { add, markChanged, search, close };
}
