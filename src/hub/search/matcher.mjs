import { fuzzyInField, lowerKeepingLength, strictInField } from "./words.mjs";

/* Every word of the query must match in the heading, the text or the attrs, in
   any order. A word matches at the best of its tiers, tried cheapest first:
     strict: exact word, word prefix, camelCase or -_/. part, substring
     fuzzy:  initials (wsl), letters in order, and one or two typos in a word
   The fuzzy tiers run only on documents that fail the strict tier, and they stop
   for the rest of the scan once FUZZY_CUTOFF documents matched strictly. Attrs
   are only tried strictly, and only for a word the heading and text don't have.

   A document has heading, text and at, and may also have attrs, type and here,
   which is true in the session the search was made from. A result is { score,
   headingRanges, textRanges, attrRanges }, plus fuzzy and typo when they apply,
   and inAttrs when a word matched only in the attrs. */

// Larger than the store's penalties for a row that has only some of the words,
// so a row with no word on the block comes after every row with one.
const ATTRS_PENALTY = 3000;
const FUZZY_CUTOFF = 30;
const MAX_RANGES = 48;
const MASK_TEXT_LIMIT = 4096;

const HEADING_BONUS = 30;
const PHRASE_HEADING_BONUS = 70;
const PHRASE_TEXT_BONUS = 50;
const WHOLE_HEADING_BONUS = 25;
const PROXIMITY_BONUS = 30;
const RECENCY_WEIGHT = 12;
const THIS_SESSION_BONUS = 15;

const KIND_BOOST = {
  "session title": 22,
  "page title": 18,
  task: 14,
  proposal: 14,
  alignment: 10,
  "thread message": 8,
  note: 8,
  "typed answer": 8,
  "send message": 6,
  "chosen option": 4,
  "page block": 2,
};

function letterBit(c) {
  if (c >= 97 && c <= 122) return 1 << (c - 97);
  if (c >= 48 && c <= 57) return 1 << 26;
  return 0;
}

function maskOf(s) {
  let m = 0;
  for (let i = 0; i < s.length; i++) m |= letterBit(s.charCodeAt(i));
  return m;
}

function docMask(doc) {
  if (doc.mask !== undefined) return doc.mask;
  doc.mask =
    doc.lowerText.length > MASK_TEXT_LIMIT
      ? -1
      : maskOf(doc.lowerHeading) | maskOf(doc.lowerText);
  return doc.mask;
}

function popcount(value) {
  let v = value;
  let n = 0;
  while (v !== 0) {
    v &= v - 1;
    n++;
  }
  return n;
}

function typoLimit(n) {
  if (n < 4) return 0;
  return n < 8 ? 1 : 2;
}

function prepare(query) {
  const lowered = lowerKeepingLength(String(query ?? "")).trim();
  if (!lowered) return null;
  const seen = new Set();
  const words = [];
  const parts = lowered.split(/\s+/);
  // A lone "a" in "drop a retried reply" would require a heading word starting with a.
  const longParts = parts.filter((w) => w.length > 1);
  for (const w of longParts.length > 0 ? longParts : parts) {
    if (seen.has(w)) continue;
    seen.add(w);
    words.push({
      w,
      n: w.length,
      mask: maskOf(w),
      fuzzy: w.length >= 3 && /^[a-z0-9_./'-]+$/.test(w),
      typos: /^[a-z0-9]+$/.test(w) ? typoLimit(w.length) : 0,
    });
  }
  words.sort((a, b) => b.n - a.n);
  return {
    words,
    phrase: parts.length > 1 ? lowered.replace(/\s+/g, " ") : null,
    strictHits: 0,
    fuzzyOn: words.some((word) => word.fuzzy),
  };
}

function shortWindow(hits) {
  if (hits.length < 2) return 0;
  const idx = Array.from({ length: hits.length }, () => 0);
  let bestSpan = Infinity;
  for (;;) {
    let lo = Infinity;
    let hi = -1;
    let loAt = -1;
    for (let k = 0; k < hits.length; k++) {
      const p = hits[k].starts[idx[k]];
      if (p < lo) {
        lo = p;
        loAt = k;
      }
      if (p + hits[k].n > hi) hi = p + hits[k].n;
    }
    if (hi - lo < bestSpan) bestSpan = hi - lo;
    idx[loAt]++;
    if (idx[loAt] >= hits[loAt].starts.length) break;
  }
  return bestSpan;
}

function proximityScore(span, wordsLength) {
  const fit = span - wordsLength;
  if (fit <= 12) return PROXIMITY_BONUS;
  if (fit >= 1200) return 0;
  return PROXIMITY_BONUS * (1 - Math.log2(fit / 12) / Math.log2(100));
}

function rangesFrom(hit) {
  if (!hit) return [];
  if (hit.runs) return hit.runs;
  const out = [];
  for (let i = 0; i < hit.starts.length && out.length < MAX_RANGES; i++) {
    out.push([hit.starts[i], hit.starts[i] + hit.n]);
  }
  return out;
}

function mergeRanges(lists) {
  if (lists.length === 1) return lists[0];
  const all = [];
  for (const list of lists) for (const r of list) all.push(r);
  if (all.length < 2) return all;
  all.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [[all[0][0], all[0][1]]];
  for (let i = 1; i < all.length; i++) {
    const last = out[out.length - 1];
    if (all[i][0] <= last[1]) {
      if (all[i][1] > last[1]) last[1] = all[i][1];
    } else {
      out.push([all[i][0], all[i][1]]);
    }
  }
  return out;
}

function docFields(doc) {
  const orig = doc.text ?? "";
  const origH = doc.heading ?? "";
  const origA = doc.attrs ?? "";
  const lh = doc.lowerHeading ?? (doc.lowerHeading = lowerKeepingLength(origH));
  const lt = doc.lowerText ?? (doc.lowerText = lowerKeepingLength(orig));
  const la = doc.lowerAttrs ?? (doc.lowerAttrs = lowerKeepingLength(origA));
  return { orig, origH, origA, lh, lt, la, mask: docMask(doc) };
}

function isSingleCharNonTitle(words, doc) {
  return (
    words.length === 1 &&
    words[0].n === 1 &&
    doc.type !== undefined &&
    doc.type !== "session title" &&
    doc.type !== "page title"
  );
}

function hasStrictSubstring(word, fields) {
  const hasLetters = (word.mask & ~fields.mask) === 0;
  if (
    hasLetters &&
    (fields.lh.indexOf(word.w) !== -1 || fields.lt.indexOf(word.w) !== -1)
  ) {
    return true;
  }
  return fields.la.indexOf(word.w) !== -1;
}

// Leave without allocating when a word cannot match, because most documents fail here.
function canMatchWord(word, fields, fuzzyOn) {
  if (hasStrictSubstring(word, fields)) return "strict";
  if (!fuzzyOn || !word.fuzzy) return null;
  if (
    fields.lt.indexOf(word.w[0]) === -1 &&
    fields.lh.indexOf(word.w[0]) === -1
  ) {
    return null;
  }
  if (popcount(word.mask & ~fields.mask) > word.typos) return null;
  return "fuzzy";
}

function prefilter(prepared, fields) {
  let allStrict = true;
  for (let k = 0; k < prepared.words.length; k++) {
    const mode = canMatchWord(prepared.words[k], fields, prepared.fuzzyOn);
    if (!mode) return null;
    if (mode === "fuzzy") allStrict = false;
  }
  return allStrict;
}

function matchWordFuzzy(word, fields) {
  const inHead = fuzzyInField(word, {
    lower: fields.lh,
    orig: fields.origH,
    inHeading: true,
  });
  const inText = inHead
    ? null
    : fuzzyInField(word, {
        lower: fields.lt,
        orig: fields.orig,
        inHeading: false,
      });
  if (!inHead && !inText) return null;
  const hit = inHead ?? inText;
  return { inHead, inText, fuzzy: true, typo: Boolean(hit.typo) };
}

function matchWord(word, fields, fuzzyOn) {
  const inHead = strictInField(word, {
    lower: fields.lh,
    orig: fields.origH,
    inHeading: true,
  });
  const inText =
    word.n === 1
      ? null
      : strictInField(word, {
          lower: fields.lt,
          orig: fields.orig,
          inHeading: false,
        });
  if (inHead || inText) return { inHead, inText };
  const attrHit =
    word.n === 1
      ? null
      : strictInField(word, {
          lower: fields.la,
          orig: fields.origA,
          inHeading: false,
        });
  if (attrHit) return { attrHit };
  if (!fuzzyOn || !word.fuzzy) return null;
  return matchWordFuzzy(word, fields);
}

function recordWordMatch(state, matched) {
  if (matched.attrHit) {
    state.inAttrs = true;
    state.attrLists.push(rangesFrom(matched.attrHit));
    state.wholeHeading = false;
    state.total += matched.attrHit.score;
    return;
  }
  const { inHead, inText } = matched;
  if (matched.fuzzy) state.usedFuzzy = true;
  if (matched.typo) state.usedTypo = true;
  const headScore = inHead ? inHead.score + HEADING_BONUS : 0;
  const textScore = inText ? inText.score : 0;
  state.total += Math.max(headScore, textScore);
  if (inHead) state.headingLists.push(rangesFrom(inHead));
  else state.wholeHeading = false;
  if (inText) {
    state.textLists.push(rangesFrom(inText));
    state.textHits.push(inText);
  }
}

function matchAllWords(prepared, fields) {
  const state = {
    total: 0,
    wholeHeading: true,
    usedFuzzy: false,
    usedTypo: false,
    inAttrs: false,
    headingLists: [],
    textLists: [],
    attrLists: [],
    textHits: [],
  };
  for (const word of prepared.words) {
    const matched = matchWord(word, fields, prepared.fuzzyOn);
    if (!matched) return null;
    recordWordMatch(state, matched);
  }
  return state;
}

function phraseBonus(prepared, fields, state) {
  if (!prepared.phrase) return 0;
  let bonus = 0;
  if (fields.lh.indexOf(prepared.phrase) !== -1) {
    bonus += PHRASE_HEADING_BONUS;
    state.headingLists.push(occurrences(fields.lh, prepared.phrase));
  } else if (fields.lt.indexOf(prepared.phrase) !== -1) {
    bonus += PHRASE_TEXT_BONUS;
    state.textLists.push(occurrences(fields.lt, prepared.phrase));
  } else if (state.textHits.length === prepared.words.length) {
    const wordsLength = prepared.words.reduce((sum, word) => sum + word.n, 0);
    bonus += proximityScore(shortWindow(state.textHits), wordsLength);
  }
  if (state.wholeHeading) bonus += WHOLE_HEADING_BONUS;
  return bonus;
}

function docBoost(doc, inAttrs) {
  let boost = RECENCY_WEIGHT * (doc.at ?? 0);
  if (doc.type !== undefined) boost += KIND_BOOST[doc.type] ?? 0;
  if (doc.here) boost += THIS_SESSION_BONUS;
  if (inAttrs) boost -= ATTRS_PENALTY;
  return boost;
}

function buildResult(score, state) {
  const result = {
    score,
    headingRanges: mergeRanges(state.headingLists),
    textRanges: mergeRanges(state.textLists),
    attrRanges: mergeRanges(state.attrLists),
  };
  if (state.usedFuzzy) result.fuzzy = true;
  if (state.usedTypo) result.typo = true;
  if (state.inAttrs) result.inAttrs = true;
  return result;
}

function scoreDoc(prepared, doc) {
  const fields = docFields(doc);
  if (isSingleCharNonTitle(prepared.words, doc)) return null;
  const allStrict = prefilter(prepared, fields);
  if (allStrict === null) return null;
  const state = matchAllWords(prepared, fields);
  if (!state) return null;

  const score =
    state.total / prepared.words.length +
    phraseBonus(prepared, fields, state) +
    docBoost(doc, state.inAttrs);

  if (allStrict && !state.inAttrs) {
    prepared.strictHits++;
    if (prepared.strictHits >= FUZZY_CUTOFF) prepared.fuzzyOn = false;
  }
  return buildResult(score, state);
}

function occurrences(lower, needle) {
  const out = [];
  let pos = lower.indexOf(needle);
  while (pos !== -1 && out.length < MAX_RANGES) {
    out.push([pos, pos + needle.length]);
    pos = lower.indexOf(needle, pos + needle.length);
  }
  return out;
}

export { prepare, scoreDoc };
