import fs from "node:fs/promises";
import path from "node:path";
import { isClosed } from "../../shared/lifecycle.mjs";
import { atomic } from "../../shared/util.mjs";
import {
  agreedDocs,
  draftDocs,
  feedbackDocs,
  placed,
  proposalDocs,
  readPage,
  threadDocs,
  titleDocs,
} from "./extract.mjs";
import { prepare, scoreDoc } from "./matcher.mjs";
import { partialRows } from "./partial.mjs";

/* The store keeps each session's search text in memory, and a cache of it in
   SESSION/search.jsonl, so a hub start reads only the files that changed. A
   cache entry counts only while its file's modified time and size and the
   extractor's version match, so it cannot go stale. Raise VERSION when
   extract.mjs changes what it reads. */
const VERSION = 3;
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
  const add = (file, read) =>
    found.push({ file, read: (record, at) => ({ docs: read(record, at) }) });
  add("status.json", (record) => titleDocs(record));
  for (const [round, set] of Object.entries(status.roundPages ?? {})) {
    const paged = (name) => path.join("pages", round, path.basename(name));
    if (set.agreed) {
      add(paged(set.agreed), (record, at) =>
        agreedDocs(record.page, round, at),
      );
    }
    for (const slot of set.pages ?? []) {
      if (slot.recordPath) {
        found.push({
          file: paged(slot.recordPath),
          read: (record, at) => readPage(record.page, round, at),
        });
      }
    }
  }
  for (const [folder, read] of [
    ["threads", threadDocs],
    ["feedback", feedbackDocs],
    ["proposals", proposalDocs],
  ]) {
    for (const name of await list(path.join(directory, folder))) {
      if (name.endsWith(".json")) add(path.join(folder, name), read);
    }
  }
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
    also: [...new Set(doc.also)].toSorted(
      (a, b) => roundNumber(a) - roundNumber(b),
    ),
    at: doc.at / RECENCY_UNIT_MS,
  };
}

function clip(doc, ranges) {
  const limit =
    doc.kind === "pages" && Number.isInteger(doc.block)
      ? BLOCK_CLIP
      : WORDS_CLIP;
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

const inRound = (doc, rounds, entry) =>
  !rounds ||
  rounds.some((round) => {
    const wanted = round === "latest" ? entry.latest : round;
    return doc.round === wanted || doc.also.includes(wanted);
  });

const titleOf = (doc, entry) =>
  PLACE_NAMES[doc.page] ??
  entry.pageTitles.get(`${doc.round}/${doc.page}`) ??
  null;

const parseCsv = (value) => (value ? value.split(",") : null);

function normalizeSearchOptions(params) {
  const sessionList = parseCsv(params.session);
  return {
    query: params.query ?? "",
    session: sessionList ? new Set(sessionList) : null,
    round: parseCsv(params.round),
    kinds: new Set(params.kinds ?? []),
    closed: params.closed ?? false,
    here: params.here ?? null,
    limit: params.limit ?? DEFAULT_LIMIT,
  };
}

function applySessionMeta(entry, status) {
  entry.title = status.title || status.current?.title || "New session";
  entry.closed = isClosed(status);
  entry.rounds = Object.keys(status.roundPages ?? {}).toSorted(
    (a, b) => roundNumber(b) - roundNumber(a),
  );
  entry.latest = entry.rounds[0] ?? "0";
  entry.updatedAt = Date.parse(status.updatedAt) || 0;
}

function indexSessionDocs(entry, files) {
  const pages = new Map();
  for (const { blocks } of files.values()) {
    if (blocks) pages.set(`${blocks.round}/${blocks.page}`, blocks);
  }
  entry.docs = grouped(
    [...files.values()].flatMap((f) => f.docs).map((doc) => placed(doc, pages)),
  ).map((doc) => ready(doc, entry.id));
  entry.pageTitles = new Map();
  for (const doc of entry.docs) {
    if (doc.type !== "page title") continue;
    for (const round of [doc.round, ...doc.also]) {
      entry.pageTitles.set(`${round}/${doc.page}`, doc.heading);
    }
  }
}

function sessionMatches(entry, { session, includeClosed }) {
  if (session && !session.has(entry.id)) return false;
  // A closed session counts when the search asks for closed ones or names it.
  return !(entry.closed && !includeClosed && !session);
}

const isBlankBrowseDoc = (prepared, doc) =>
  !prepared && !doc.text && !doc.attrs;

function recordScanHit(doc, hit, { inKind, acc }) {
  acc.counts[doc.kind]++;
  if (!inKind) return;
  acc.total++;
  if (!hit.inAttrs) acc.onBlocks++;
  acc.hits.push({ doc, ...hit });
}

function scanSessionDocs(entry, { prepared, round, kinds, here }, acc) {
  for (const doc of entry.docs) {
    if (!inRound(doc, round, entry)) continue;
    // With nothing typed, the list shows the newest things that have words.
    if (isBlankBrowseDoc(prepared, doc)) continue;
    doc.here = doc.session === here;
    const hit = prepared ? scoreDoc(prepared, doc) : { score: doc.at };
    const inKind = kinds.size === 0 || kinds.has(doc.kind);
    if (inKind) acc.inScope.push(doc);
    if (hit) recordScanHit(doc, hit, { inKind, acc });
  }
}

function addPartialHits(query, acc) {
  const already = new Set(acc.hits.map((hit) => hit.doc));
  const candidates = acc.inScope.filter((doc) => !already.has(doc));
  for (const partialHit of partialRows(query, candidates)) {
    acc.counts[partialHit.doc.kind]++;
    acc.total++;
    acc.hits.push(partialHit);
  }
}

const WIDER_STEPS = [
  {
    filter: "kinds",
    applies: (o) => o.kinds.size > 0,
    change: () => ({ kinds: new Set() }),
  },
  {
    filter: "rounds",
    applies: (o) => Boolean(o.round),
    change: () => ({ kinds: new Set(), round: null }),
  },
  {
    filter: "sessions",
    applies: (o) => Boolean(o.session),
    change: () => ({ kinds: new Set(), round: null, session: null }),
  },
  {
    filter: "closed",
    applies: (o) => !o.closed,
    change: () => ({
      kinds: new Set(),
      round: null,
      session: null,
      closed: true,
    }),
  },
];

export function searchStore({ log = () => {} } = {}) {
  const sessions = new Map();
  let pendingLoads = 0;
  let closed = false;
  let queue = Promise.resolve();

  async function loadSourceFile(entry, { file, read }) {
    const full = path.join(entry.directory, file);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat) return null;
    const known = entry.files.get(file);
    if (known?.mtimeMs === stat.mtimeMs && known.size === stat.size) {
      return { entry: known, wrote: false };
    }
    let contents = { docs: [] };
    try {
      contents = read(await readJson(full), stat.mtimeMs);
    } catch (error) {
      log(`search skipped ${full}: ${error.message}`);
    }
    return {
      entry: { mtimeMs: stat.mtimeMs, size: stat.size, ...contents },
      wrote: true,
    };
  }

  async function readFiles(entry) {
    const status = await readJson(path.join(entry.directory, "status.json"));
    const files = new Map();
    let wrote = false;
    for (const source of await sources(entry.directory, status)) {
      if (closed) return;
      const loaded = await loadSourceFile(entry, source);
      if (!loaded) continue;
      if (loaded.wrote) wrote = true;
      files.set(source.file, loaded.entry);
    }
    const removed = [...entry.files.keys()].some((file) => !files.has(file));
    entry.files = files;
    applySessionMeta(entry, status);
    indexSessionDocs(entry, files);
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
        const { file, ...cached } = JSON.parse(line);
        entry.files.set(file, cached);
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
        for (const [file, cached] of entry.files) {
          lines.push(JSON.stringify({ file, ...cached }));
        }
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
        while (entry.changed) {
          if (closed) break;
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
      rounds: [],
      latest: "0",
      updatedAt: 0,
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

  const refreshChanged = () =>
    Promise.all(
      [...sessions.values()]
        .filter((entry) => entry.loaded && (entry.changed || entry.reading))
        .map(refresh),
    );

  function scan(options) {
    const {
      query,
      session,
      round,
      kinds,
      closed: includeClosed,
      here,
      limit,
    } = options;
    const prepared = prepare(query);
    const acc = {
      counts: Object.fromEntries(KINDS.map((kind) => [kind, 0])),
      hits: [],
      inScope: [],
      total: 0,
      onBlocks: 0,
    };
    const filter = { prepared, round, kinds, here };
    for (const entry of sessions.values()) {
      if (!sessionMatches(entry, { session, includeClosed })) continue;
      scanSessionDocs(entry, filter, acc);
    }
    if (prepared && acc.onBlocks < FEW_RESULTS) addPartialHits(query, acc);
    acc.hits.sort((a, b) => b.score - a.score);
    const maxHits = query.trim().length === 1 ? ONE_LETTER_LIMIT : limit;
    return {
      hits: acc.hits.slice(0, maxHits),
      total: acc.total,
      counts: acc.counts,
    };
  }

  function row(hit) {
    const { doc } = hit;
    const entry = sessions.get(doc.session);
    return {
      session: doc.session,
      sessionTitle: entry.title,
      ...(entry.closed ? { closed: true } : {}),
      round: doc.round,
      page: doc.page,
      pageTitle: titleOf(doc, entry),
      block: doc.block,
      blockId: doc.blockId ?? null,
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
    for (const step of WIDER_STEPS) {
      if (!step.applies(options)) continue;
      const { total } = scan({ ...options, ...step.change() });
      if (total) return { filter: step.filter, total };
    }
    return null;
  }

  async function search(params) {
    const started = performance.now();
    await refreshChanged();
    const options = normalizeSearchOptions(params);
    const { hits, total, counts } = scan(options);
    return {
      results: hits.map(row),
      total,
      counts,
      ms: Math.round(performance.now() - started),
      ...(total === 0 && prepare(options.query)
        ? { wider: wider(options) }
        : {}),
      ...(pendingLoads ? { loading: true } : {}),
    };
  }

  // What a search can be narrowed to, the session worked on last first. The
  // search window asks for this while it runs its first search, so the two
  // share one read of whatever changed.
  async function sessionChoices() {
    await refreshChanged();
    return [...sessions.values()]
      .filter((entry) => entry.loaded)
      .toSorted((a, b) => b.updatedAt - a.updatedAt)
      .map(({ id, title, rounds, closed: entryClosed }) => ({
        id,
        title,
        rounds,
        closed: entryClosed,
      }));
  }

  async function close() {
    closed = true;
    await queue;
    await Promise.all(
      [...sessions.values()].flatMap((entry) => [entry.reading, entry.writing]),
    );
  }

  return { add, markChanged, search, sessionChoices, close };
}
