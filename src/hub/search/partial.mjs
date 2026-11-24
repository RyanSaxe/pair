import { prepare, scoreDoc } from "./matcher.mjs";

const tidy = (ranges) => {
  const sorted = ranges.toSorted((a, b) => a[0] - b[0]);
  return sorted.filter(
    (range, index) => index === 0 || range[0] >= sorted[index - 1][1],
  );
};

function recordPartHit(found, { doc, index, hit }) {
  let entry = found.get(doc);
  if (!entry) {
    entry = {
      doc,
      words: new Set(),
      score: 0,
      textRanges: [],
      headingRanges: [],
      attrRanges: [],
    };
    found.set(doc, entry);
  }
  entry.words.add(index);
  entry.score += hit.score;
  entry.textRanges.push(...hit.textRanges);
  entry.headingRanges.push(...hit.headingRanges);
  entry.attrRanges.push(...hit.attrRanges);
}

function collectPartHits(parts, docs) {
  const found = new Map();
  parts.forEach((part, index) => {
    const prepared = prepare(part);
    if (!prepared) return;
    for (const doc of docs) {
      const hit = scoreDoc(prepared, doc);
      if (hit) recordPartHit(found, { doc, index, hit });
    }
  });
  return found;
}

function finalizeEntry(entry) {
  // Each word's score includes the recency bonus, so a row keeps the mean to
  // stay on the scale of a block with every word.
  entry.score /= entry.words.size;
  entry.textRanges = tidy(entry.textRanges);
  entry.headingRanges = tidy(entry.headingRanges);
  entry.attrRanges = tidy(entry.attrRanges);
}

function trackPageWords(pages, entry) {
  const { session, round, page } = entry.doc;
  const key = `${session}|${round}|${page}`;
  let holder = pages.get(key);
  if (!holder) {
    holder = { words: new Set(), best: entry };
    pages.set(key, holder);
  }
  for (const word of entry.words) holder.words.add(word);
  if (entry.words.size > holder.best.words.size) holder.best = entry;
}

// When few blocks have every word, a block with all but one word counts, and so
// does a page whose blocks have every word between them.
export function partialRows(query, docs) {
  const parts = query.trim().split(/\s+/);
  if (parts.length < 2) return [];
  const found = collectPartHits(parts, docs);
  const pages = new Map();
  const rows = [];
  for (const entry of found.values()) {
    finalizeEntry(entry);
    if (parts.length >= 3 && entry.words.size === parts.length - 1) {
      rows.push({
        ...entry,
        score: entry.score - 1000,
        partial: `Has ${entry.words.size} of ${parts.length} words`,
      });
    }
    trackPageWords(pages, entry);
  }
  for (const holder of pages.values()) {
    if (
      holder.words.size === parts.length &&
      !rows.some((row) => row.doc === holder.best.doc)
    ) {
      rows.push({
        ...holder.best,
        score: holder.best.score - 2000,
        partial: "All words on this page",
      });
    }
  }
  return rows;
}
