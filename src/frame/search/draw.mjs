import { enhance } from "#frame/app/registry.mjs";
import { $ } from "#frame/app/util.mjs";
import { plan, setPage } from "#frame/app/view.mjs";
import { findWords, scrollToRange, visibleRange } from "#frame/notes/match.mjs";
import { highlight } from "#frame/notes/notes.mjs";
import { agreementCard } from "#frame/pages/agreed.mjs";
import { disposeRenderers, renders } from "#frame/pages/renderers.mjs";

/* This code runs in the preview document, the one document the search modal
   keeps loaded. It draws one result the way show() draws a page: the block's
   HTML goes into #page-content and enhance() draws its components. So a diff, a
   decision or a custom component appears as itself with no code here.

   The new block draws hidden until it has finished or SWAP_WAIT_MS has passed,
   so the old one stays on screen and nothing flashes. */
const SWAP_WAIT_MS = 250;
const SETTLE_LIMIT_MS = 4000;
// Components rewrite their text after they first draw, as a code highlighter
// and the diff library do, so the highlight follows until the block is quiet.
const REMARK_MS = 40;
const QUIET_MS = 160;

const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const isHeading = (element) => /^H[1-6]$/.test(element.tagName);

let drawn = null;
let latest = 0;
let pageStyle;
const scripts = new Map();

function setScope(id, round, page) {
  const content = $("page-content");
  content.dataset.pageId = id;
  content.dataset.round = round;
  setPage({ id, title: page.title ?? "", html: page.html ?? "" });
  plan.prototypes = page.prototypes ?? [];
  pageStyle.textContent = page.cssText
    ? `@layer plan { @scope (#page-content[data-page-id="${id}"][data-round="${round}"]) { ${page.cssText} } }`
    : "";
}

// A page's own script runs on its block as it does on the page. A script written
// for the whole page can fail on one block, and the block still shows.
async function runPageScript(page, version, root) {
  if (!page.jsText) return;
  try {
    if (!scripts.has(version)) {
      const url = URL.createObjectURL(
        new Blob([page.jsText], { type: "text/javascript" }),
      );
      scripts.set(version, import(url));
    }
    const { setup } = await scripts.get(version);
    await setup?.(root, window.planUI);
  } catch (error) {
    console.error("Page script in the preview:", error);
  }
}

function buildBlock({ page, block, heading, said }) {
  const template = document.createElement("template");
  template.innerHTML = page.html ?? "";
  const blocks = [...template.content.children];
  const element = blocks[block];
  if (!element) throw Error("The page has no such block.");
  element.id ||= `block-${page.id}-${block}`;
  const root = document.createElement("div");
  const roots = [element];
  if (said) {
    const box = document.createElement("div");
    box.className = "search-said";
    const label = document.createElement("b");
    label.textContent = said.label;
    const words = document.createElement("div");
    words.textContent = said.text;
    box.append(label, words);
    root.append(box);
    roots.unshift(words);
  } else if (heading && !isHeading(element)) {
    const above = blocks.slice(0, block).findLast(isHeading);
    if (above) {
      const copy = above.cloneNode(true);
      copy.removeAttribute("id");
      root.append(copy);
      roots.unshift(copy);
    }
  }
  root.append(element);
  return { root, roots };
}

function mark() {
  if (!drawn?.root.isConnected) return;
  const ranges = findWords(drawn.roots, drawn.words);
  const target = visibleRange(ranges, { open: drawn.settled });
  highlight("plan-preview", ranges);
  if (target && !drawn.scrolled) {
    drawn.scrolled = true;
    scrollToRange(target);
  }
  drawn.report({ found: Boolean(target), settled: drawn.settled });
}

function changed() {
  const current = drawn;
  if (!current) return;
  clearTimeout(current.timer);
  current.timer = setTimeout(() => {
    current.scrolled = false;
    mark();
    if (!current.ready || current.settled) return;
    current.timer = setTimeout(() => {
      current.settled = true;
      mark();
    }, QUIET_MS);
  }, REMARK_MS);
}

function show(next, content) {
  const old = drawn;
  if (old) {
    clearTimeout(old.timer);
    old.observer.disconnect();
    disposeRenderers(old.root);
  }
  for (const child of [...content.children])
    if (child !== next.root) child.remove();
  next.root.hidden = false;
  next.root.classList.remove("search-drawing");
  window.scrollTo(0, 0);
  drawn = next;
  drawn.observer = new MutationObserver(changed);
  drawn.observer.observe(next.root, {
    subtree: true,
    childList: true,
    characterData: true,
  });
}

/* draw() takes a page's record and which part of it to show. report hears each
   time the words are found on screen or not, and whether the block has finished
   drawing. It rejects when the record has no such block or item, so the modal
   shows the result's words instead. */
async function draw({
  key,
  page,
  round,
  version,
  block,
  item,
  heading,
  said,
  words,
  report,
}) {
  if (drawn?.key === key) {
    Object.assign(drawn, { words, report, scrolled: false });
    mark();
    return;
  }
  const mine = ++latest;
  const content = $("page-content");
  let built;
  if (item) {
    const entry = page.agreements?.find((candidate) => candidate.id === item);
    if (!entry) throw Error("Agreed has no such item.");
    const root = document.createElement("div");
    root.append(agreementCard(entry));
    built = { root, roots: [root] };
  } else built = buildBlock({ page, block, heading, said });
  built.root.classList.add("search-drawing");
  setScope(page.id, round, page);
  content.append(built.root);
  const drawing = enhance(built.root);
  await runPageScript(page, version, built.root);
  const finished = Promise.allSettled([drawing, ...renders]);
  await Promise.race([finished, wait(SWAP_WAIT_MS)]);
  if (mine !== latest) {
    disposeRenderers(built.root);
    built.root.remove();
    return;
  }
  show(
    {
      key,
      ...built,
      words,
      report,
      scrolled: false,
      settled: false,
      ready: false,
      timer: 0,
    },
    content,
  );
  const current = drawn;
  mark();
  await Promise.race([finished, wait(SETTLE_LIMIT_MS)]);
  current.ready = true;
  if (current === drawn) changed();
}

export function installBlockDrawing() {
  document.documentElement.dataset.searchPreview = "";
  pageStyle = document.createElement("style");
  document.head.append(pageStyle);
  window.addEventListener("plan:diff", changed);
  // A click in a block stays in the preview, so a link leads nowhere here.
  window.addEventListener(
    "click",
    (event) => {
      if (event.target.closest?.("a")) event.preventDefault();
    },
    true,
  );
  window.pairPreview = { draw };
}
