// Matches one query word against one field, heading or text. strictInField()
// finds the word as written, and fuzzyInField() finds its initials, its letters
// in order, or a typo. A letter match can never span a document: it starts on a
// word start, stays inside one word or file name and fits in fuzzySpan(n)
// characters. Initials match only in headings, because in body text a
// three-letter query finds them in 1,637 documents.

const MAX_OCCURRENCES = 48;

const TIER_EXACT = 100;
const TIER_PREFIX = 82;
const TIER_PART_EXACT = 78;
const TIER_PART_PREFIX = 70;
const TIER_SUBSTRING = 50;
const TIER_INITIALS = 46;
const TIER_LETTERS_ONE_WORD = 44;
const TIER_LETTERS_ACROSS = 24;
const TIER_TYPO_ONE = 40;
const TIER_TYPO_TWO = 26;

const WORD_CHAR = new Uint8Array(128);
for (let c = 48; c <= 57; c++) WORD_CHAR[c] = 1;
for (let c = 65; c <= 90; c++) WORD_CHAR[c] = 1;
for (let c = 97; c <= 122; c++) WORD_CHAR[c] = 1;

// Letters may cross these inside one identifier or file name, and nothing else.
const IDENTIFIER_JOIN = new Uint8Array(128);
for (const c of "-_/.'") IDENTIFIER_JOIN[c.charCodeAt(0)] = 1;

function isWordChar(c) {
  if (c < 128) return WORD_CHAR[c] === 1;
  return !(c >= 0x2000 && c <= 0x206f);
}

export function lowerKeepingLength(s) {
  let l = s.toLowerCase();
  if (l.length !== s.length) {
    let out = "";
    for (let i = 0; i < s.length; i++) {
      const c = s[i].toLowerCase();
      out += c.length === 1 ? c : s[i];
    }
    l = out;
  }
  if (l.indexOf("’") !== -1) l = l.replaceAll("’", "'");
  return l;
}

function fuzzySpan(n) {
  return n * 2 + 2;
}

function isWordStart(lower, orig, i) {
  if (i === 0) return 2;
  const prev = lower.charCodeAt(i - 1);
  if (prev === 39 && i > 1 && isWordChar(lower.charCodeAt(i - 2))) return 0;
  if (!isWordChar(prev)) return 2;
  if (
    orig.charCodeAt(i) !== lower.charCodeAt(i) &&
    orig.charCodeAt(i - 1) === prev
  )
    return 1;
  return 0;
}

function isWordEnd(lower, orig, end) {
  if (end >= lower.length) return true;
  const c = lower.charCodeAt(end);
  if (!isWordChar(c)) return true;
  return (
    orig.charCodeAt(end) !== c &&
    orig.charCodeAt(end - 1) === lower.charCodeAt(end - 1)
  );
}

export function strictInField(word, lower, orig, inHeading) {
  const { w, n } = word;
  let pos = lower.indexOf(w);
  if (pos === -1) return null;
  let best = 0;
  let seen = 0;
  let starts = null;
  while (pos !== -1 && seen < MAX_OCCURRENCES) {
    const start = isWordStart(lower, orig, pos);
    const end = isWordEnd(lower, orig, pos + n);
    let tier = 0;
    if (start === 2) tier = end ? TIER_EXACT : TIER_PREFIX;
    else if (start === 1) tier = end ? TIER_PART_EXACT : TIER_PART_PREFIX;
    else if (n >= 3) tier = TIER_SUBSTRING;
    if (n === 1 && !(inHeading && start === 2)) tier = 0;
    if (n === 2 && !(end && start > 0) && !(inHeading && start > 0)) tier = 0;
    if (tier > 0) {
      if (tier > best) best = tier;
      if (starts === null) starts = [];
      starts.push(pos);
    }
    seen++;
    pos = lower.indexOf(w, pos + n);
  }
  if (best === 0) return null;
  return { score: best, starts, runs: null, n };
}

// One to two typos in a word, as Damerau-Levenshtein. Three rolling rows are
// enough, and the search leaves as soon as a row exceeds the limit.
const rowA = new Int32Array(64);
const rowB = new Int32Array(64);
const rowC = new Int32Array(64);

function typoDistance(q, n, s, from, len, limit) {
  if (Math.abs(len - n) > limit) return limit + 1;
  let prev2 = rowA;
  let prev = rowB;
  let cur = rowC;
  for (let j = 0; j <= len; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    let least = i;
    const qc = q.charCodeAt(i - 1);
    for (let j = 1; j <= len; j++) {
      const sc = s.charCodeAt(from + j - 1);
      let v = prev[j - 1] + (qc === sc ? 0 : 1);
      if (prev[j] + 1 < v) v = prev[j] + 1;
      if (cur[j - 1] + 1 < v) v = cur[j - 1] + 1;
      if (
        i > 1 &&
        j > 1 &&
        qc === s.charCodeAt(from + j - 2) &&
        q.charCodeAt(i - 2) === sc
      ) {
        if (prev2[j - 2] + 1 < v) v = prev2[j - 2] + 1;
      }
      cur[j] = v;
      if (v < least) least = v;
    }
    if (least > limit) return limit + 1;
    const t = prev2;
    prev2 = prev;
    prev = cur;
    cur = t;
  }
  return prev[len];
}

// Initials walk the word starts after pos. One skipped word is allowed, as in "wsl" for
// "windows subsystem for linux". Returns the skipped count, or -1.
function tryInitials(w, n, lower, orig, pos) {
  const limit = Math.min(lower.length, pos + n * 14);
  let qi = 1;
  let skipped = 0;
  for (let i = pos + 1; i < limit; i++) {
    const c = lower.charCodeAt(i);
    if (c === 10) return -1;
    if (c < 128 && WORD_CHAR[c] === 0) continue;
    if (isWordStart(lower, orig, i) === 0) continue;
    if (c === w.charCodeAt(qi)) {
      if (++qi === n) return skipped;
    } else if (++skipped > 1) {
      return -1;
    }
  }
  return -1;
}

function initialsRuns(w, n, lower, orig, pos) {
  const runs = [[pos, pos + 1]];
  let qi = 1;
  for (let i = pos + 1; qi < n; i++) {
    if (
      lower.charCodeAt(i) === w.charCodeAt(qi) &&
      isWordStart(lower, orig, i) > 0
    ) {
      runs.push([i, i + 1]);
      qi++;
    }
  }
  return runs;
}

let lettersBoundaries = 0;

// Returns the end of the letters on one line within the span, or -1.
function tryLetters(word, lower, pos) {
  const { w, n } = word;
  const limit = Math.min(lower.length, pos + fuzzySpan(n));
  let qi = 1;
  let target = w.charCodeAt(1);
  let boundaries = 0;
  for (let i = pos + 1; i < limit; i++) {
    const c = lower.charCodeAt(i);
    if (c === target) {
      qi++;
      if (qi === n) {
        lettersBoundaries = boundaries;
        return i + 1;
      }
      target = w.charCodeAt(qi);
    }
    if (c < 128 && WORD_CHAR[c] === 0) {
      if (IDENTIFIER_JOIN[c] === 0) return -1;
      boundaries++;
    }
  }
  return -1;
}

function lettersRuns(word, lower, pos) {
  const { w, n } = word;
  const runs = [];
  let qi = 0;
  let target = w.charCodeAt(0);
  for (let i = pos; qi < n; i++) {
    if (lower.charCodeAt(i) !== target) continue;
    const last = runs[runs.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else runs.push([i, i + 1]);
    qi++;
    if (qi < n) target = w.charCodeAt(qi);
  }
  return runs;
}

export function fuzzyInField(word, lower, orig, inHeading) {
  const { w, n, typos } = word;
  const first = w[0];
  const initialsAllowed = inHeading && n <= 5;
  let best = 0;
  let bestPos = -1;
  let bestKind = 0;
  let bestEnd = -1;
  let pos = lower.indexOf(first);
  for (; pos !== -1; pos = lower.indexOf(first, pos + 1)) {
    if (isWordStart(lower, orig, pos) === 0) continue;
    const end = tryLetters(word, lower, pos);
    if (end !== -1) {
      const tier =
        lettersBoundaries === 0 ? TIER_LETTERS_ONE_WORD : TIER_LETTERS_ACROSS;
      const score = tier - (end - pos - n) * 2;
      if (score > best) {
        best = score;
        bestPos = pos;
        bestKind = 1;
      }
    }
    if (initialsAllowed && best < TIER_INITIALS) {
      const skipped = tryInitials(w, n, lower, orig, pos);
      if (skipped !== -1 && TIER_INITIALS - skipped * 8 > best) {
        best = TIER_INITIALS - skipped * 8;
        bestPos = pos;
        bestKind = 2;
      }
    }
    if (typos > 0 && best < TIER_TYPO_ONE) {
      let stop = pos + 1;
      const most = Math.min(lower.length, pos + n + typos + 1);
      while (stop < most && isWordChar(lower.charCodeAt(stop))) stop++;
      const whole =
        stop === lower.length || !isWordChar(lower.charCodeAt(stop));
      if (whole && stop - pos >= n - typos) {
        const d = typoDistance(w, n, lower, pos, stop - pos, typos);
        if (d <= typos) {
          const score = d === 1 ? TIER_TYPO_ONE : TIER_TYPO_TWO;
          if (score > best) {
            best = score;
            bestPos = pos;
            bestKind = 3;
            bestEnd = stop;
          }
        }
      }
    }
  }
  if (best === 0) return null;
  let runs;
  if (bestKind === 1) runs = lettersRuns(word, lower, bestPos);
  else if (bestKind === 2) runs = initialsRuns(w, n, lower, orig, bestPos);
  else runs = [[bestPos, bestEnd]];
  return { score: best, starts: [bestPos], runs, n, typo: bestKind === 3 };
}
