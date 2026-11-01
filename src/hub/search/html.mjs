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
function parseAttrs(s, i, end, attrs) {
  while (i < end) {
    while (i < end && /[\s/]/.test(s[i])) i++;
    if (i >= end) break;
    const start = i;
    while (i < end && !/[\s=/>]/.test(s[i])) i++;
    const name = s.slice(start, i).toLowerCase();
    while (i < end && /\s/.test(s[i])) i++;
    let value = "";
    if (s[i] === "=") {
      i++;
      while (i < end && /\s/.test(s[i])) i++;
      const q = s[i];
      if (q === '"' || q === "'") {
        const close = s.indexOf(q, i + 1);
        const stop = close < 0 ? end : close;
        value = s.slice(i + 1, stop);
        i = stop + 1;
      } else {
        const st = i;
        while (i < end && !/[\s>]/.test(s[i])) i++;
        value = s.slice(st, i);
      }
    }
    if (name) attrs[name] = value.startsWith("data:") ? "data:" : decode(value);
  }
}
// tagEnd finds the > that closes a tag, skipping quoted attribute values, which
// can be megabytes of base64.
function tagEnd(s, i) {
  let q = null;
  for (; i < s.length; i++) {
    const c = s[i];
    if (q) {
      const next = s.indexOf(q, i);
      if (next < 0) return -1;
      i = next;
      q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === ">") return i;
  }
  return -1;
}
export function parse(s) {
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  let i = 0;
  const top = () => stack[stack.length - 1];
  const addText = (t) => {
    if (t) top().children.push({ text: decode(t) });
  };
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) {
      addText(s.slice(i));
      break;
    }
    addText(s.slice(i, lt));
    if (s.startsWith("<!--", lt)) {
      const e = s.indexOf("-->", lt + 4);
      i = e < 0 ? s.length : e + 3;
      continue;
    }
    if (s[lt + 1] === "!" || s[lt + 1] === "?") {
      const e = s.indexOf(">", lt);
      i = e < 0 ? s.length : e + 1;
      continue;
    }
    if (s[lt + 1] === "/") {
      const e = s.indexOf(">", lt);
      if (e < 0) break;
      const name = s
        .slice(lt + 2, e)
        .trim()
        .toLowerCase();
      for (let k = stack.length - 1; k > 0; k--)
        if (stack[k].tag === name) {
          stack.length = k;
          break;
        }
      i = e + 1;
      continue;
    }
    if (!/[a-zA-Z]/.test(s[lt + 1] || "")) {
      addText("<");
      i = lt + 1;
      continue;
    }
    const e = tagEnd(s, lt + 1);
    if (e < 0) break;
    let n = lt + 1;
    while (n < e && !/[\s/>]/.test(s[n])) n++;
    const tag = s.slice(lt + 1, n).toLowerCase();
    const attrs = {};
    parseAttrs(s, n, e, attrs);
    const closes = CLOSES[tag];
    if (closes) {
      for (let k = stack.length - 1; k > 0; k--) {
        if (closes.includes(stack[k].tag)) {
          stack.length = k;
          break;
        }
        if (
          [
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
          ].includes(stack[k].tag)
        )
          break;
      }
    }
    if (top().tag === "p" && BLOCK_STARTS_P.has(tag)) stack.pop();
    const node = { tag, attrs, children: [] };
    top().children.push(node);
    if (RAW.has(tag)) {
      const close = new RegExp(`</${tag}\\s*>`, "i");
      const rest = s.slice(e + 1);
      const m = close.exec(rest);
      const end = m ? m.index : rest.length;
      node.raw = rest.slice(0, end);
      i = e + 1 + end + (m ? m[0].length : 0);
      continue;
    }
    if (!VOID.has(tag) && s[e - 1] !== "/") stack.push(node);
    i = e + 1;
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
    if (
      n.tag === "script" ||
      n.tag === "style" ||
      n.tag === "textarea" ||
      n.tag === "template"
    )
      return;
    if (skip && skip(n)) return;
    const block = !INLINE.has(n.tag);
    if (block) out.push(" ");
    if (n.tag === "br") out.push(" ");
    for (const c of n.children) walk(c);
    if (block) out.push(" ");
  };
  walk(node);
  return out.join("").replace(/\s+/g, " ").trim();
}
