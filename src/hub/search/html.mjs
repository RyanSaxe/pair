// A small HTML parser for page fragments. It keeps enough of the tree to split
// a page into the frame's top-level blocks. Zero dependencies.
const VOID = new Set(
  "area base br col embed hr img input link meta param source track wbr".split(
    " ",
  ),
);
const RAW = new Set(["script", "style", "textarea"]);
const CLOSES = {
  li: ["li"],
  p: ["p"],
  td: ["td", "th"],
  th: ["td", "th"],
  tr: ["tr", "td", "th"],
  dt: ["dt", "dd"],
  dd: ["dt", "dd"],
  option: ["option"],
};
const BLOCK_STARTS_P = new Set(
  "address article aside blockquote details div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr main nav ol p pre section table ul".split(
    " ",
  ),
);
const ENT = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  rarr: "→",
  larr: "←",
  hellip: "…",
  times: "×",
  middot: "·",
  check: "✓",
  darr: "↓",
  uarr: "↑",
  le: "≤",
  ge: "≥",
  ne: "≠",
  bull: "•",
  laquo: "«",
  raquo: "»",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
};
export const decode = (s) =>
  s.indexOf("&") < 0
    ? s
    : s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
        if (e[0] === "#") {
          const code =
            e[1] === "x" || e[1] === "X"
              ? parseInt(e.slice(2), 16)
              : parseInt(e.slice(1), 10);
          try {
            return String.fromCodePoint(code);
          } catch {
            return m;
          }
        }
        return ENT[e] ?? ENT[e.toLowerCase()] ?? m;
      });
const AUTO_CLOSE_BOUNDARIES = new Set([
  "ul",
  "ol",
  "table",
  "tbody",
  "thead",
  "section",
  "div",
  "dl",
  "figure",
  "details",
  "article",
]);
const SKIP_TEXT_TAGS = new Set(["script", "style", "textarea", "template"]);

function skipMatching(s, { from, end }, pattern) {
  let i = from;
  while (i < end && pattern.test(s[i])) i++;
  return i;
}

function readAttrValue(s, from, end) {
  const start = skipMatching(s, { from, end }, /\s/);
  const q = s[start];
  if (q === '"' || q === "'") {
    const close = s.indexOf(q, start + 1);
    const stop = close < 0 ? end : close;
    return { value: s.slice(start + 1, stop), next: stop + 1 };
  }
  const stop = skipMatching(s, { from: start, end }, /[^\s>]/);
  return { value: s.slice(start, stop), next: stop };
}

function parseAttrs(s, { from, end }, attrs) {
  let i = from;
  while (i < end) {
    i = skipMatching(s, { from: i, end }, /[\s/]/);
    if (i >= end) break;
    const start = i;
    i = skipMatching(s, { from: i, end }, /[^\s=/>]/);
    const name = s.slice(start, i).toLowerCase();
    i = skipMatching(s, { from: i, end }, /\s/);
    let value = "";
    if (s[i] === "=") {
      ({ value, next: i } = readAttrValue(s, i + 1, end));
    }
    if (name) {
      attrs[name] = value.startsWith("data:") ? "data:" : decode(value);
    }
  }
}

// tagEnd finds the > that closes a tag, skipping quoted attribute values, which
// can be megabytes of base64.
function tagEnd(s, from) {
  let q = null;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (q) {
      const next = s.indexOf(q, i);
      if (next < 0) return -1;
      i = next;
      q = null;
    } else if (c === '"' || c === "'") {
      q = c;
    } else if (c === ">") {
      return i;
    }
  }
  return -1;
}

function skipSpecialTag(s, lt) {
  if (s.startsWith("<!--", lt)) {
    const e = s.indexOf("-->", lt + 4);
    return e < 0 ? s.length : e + 3;
  }
  if (s[lt + 1] === "!" || s[lt + 1] === "?") {
    const e = s.indexOf(">", lt);
    return e < 0 ? s.length : e + 1;
  }
  return -1;
}

function closeTag(stack, name) {
  for (let k = stack.length - 1; k > 0; k--) {
    if (stack[k].tag === name) {
      stack.length = k;
      return;
    }
  }
}

function parseCloseTag(s, lt, stack) {
  const e = s.indexOf(">", lt);
  if (e < 0) return -1;
  const name = s
    .slice(lt + 2, e)
    .trim()
    .toLowerCase();
  closeTag(stack, name);
  return e + 1;
}

function closeImplicit(stack, tag) {
  const closes = CLOSES[tag];
  if (closes) {
    for (let k = stack.length - 1; k > 0; k--) {
      const open = stack[k].tag;
      if (closes.includes(open)) {
        stack.length = k;
        break;
      }
      if (AUTO_CLOSE_BOUNDARIES.has(open)) break;
    }
  }
  if (stack[stack.length - 1].tag === "p" && BLOCK_STARTS_P.has(tag)) {
    stack.pop();
  }
}

function readRawElement(s, node, afterOpen) {
  const close = new RegExp(`</${node.tag}\\s*>`, "i");
  const rest = s.slice(afterOpen);
  const m = close.exec(rest);
  const end = m ? m.index : rest.length;
  node.raw = rest.slice(0, end);
  return afterOpen + end + (m ? m[0].length : 0);
}

function parseOpenTag(s, lt, stack) {
  const e = tagEnd(s, lt + 1);
  if (e < 0) return -1;
  const n = skipMatching(s, { from: lt + 1, end: e }, /[^\s/>]/);
  const tag = s.slice(lt + 1, n).toLowerCase();
  const attrs = {};
  parseAttrs(s, { from: n, end: e }, attrs);
  closeImplicit(stack, tag);
  const node = { tag, attrs, children: [] };
  stack[stack.length - 1].children.push(node);
  if (RAW.has(tag)) return readRawElement(s, node, e + 1);
  if (!VOID.has(tag) && s[e - 1] !== "/") stack.push(node);
  return e + 1;
}

function stepTag(s, lt, stack) {
  const special = skipSpecialTag(s, lt);
  if (special >= 0) return special;
  if (s[lt + 1] === "/") return parseCloseTag(s, lt, stack);
  if (!/[a-zA-Z]/.test(s[lt + 1] || "")) {
    stack[stack.length - 1].children.push({ text: "<" });
    return lt + 1;
  }
  return parseOpenTag(s, lt, stack);
}

export function parse(s) {
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  let i = 0;
  const addText = (t) => {
    if (t) stack[stack.length - 1].children.push({ text: decode(t) });
  };
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) {
      addText(s.slice(i));
      break;
    }
    addText(s.slice(i, lt));
    const next = stepTag(s, lt, stack);
    if (next < 0) break;
    i = next;
  }
  return root;
}
const INLINE = new Set(
  "a abbr b bdi bdo cite code data del dfn em i ins kbd mark q s samp small span strong sub sup time u var".split(
    " ",
  ),
);
export function textOf(node, skip) {
  const out = [];
  const walk = (n) => {
    if (n.text !== undefined) {
      out.push(n.text);
      return;
    }
    if (SKIP_TEXT_TAGS.has(n.tag)) return;
    if (skip?.(n)) return;
    const block = !INLINE.has(n.tag);
    if (block) out.push(" ");
    if (n.tag === "br") out.push(" ");
    for (const c of n.children) walk(c);
    if (block) out.push(" ");
  };
  walk(node);
  return out.join("").replace(/\s+/g, " ").trim();
}
