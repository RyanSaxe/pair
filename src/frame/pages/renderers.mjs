import { $, copyText, installPanel } from "#frame/app/util.mjs";
import { libraries } from "#shared/libraries.mjs";

let systemTheme;
let preferredTheme = null;
let activeTheme;
export function installRenderers() {
  systemTheme = matchMedia("(prefers-color-scheme: dark)");
  try {
    if (/^https?:$/.test(location.protocol)) {
      const value = document.cookie
        .split("; ")
        .find((item) => item.startsWith("pair-theme="))
        ?.split("=")[1];
      if (["light", "dark"].includes(value)) preferredTheme = value;
    }
  } catch {
    /* When reading the cookie throws, the reader can still change the
       theme. */
  }
  activeTheme = preferredTheme || (systemTheme.matches ? "dark" : "light");
  installPanel($("settings-pop"), $("settings"));
  $("theme").addEventListener("click", (event) => {
    const button = event.target.closest("[data-theme]");
    if (!button) return;
    preferredTheme =
      button.dataset.theme === "system" ? null : button.dataset.theme;
    activeTheme = preferredTheme || (systemTheme.matches ? "dark" : "light");
    try {
      if (/^https?:$/.test(location.protocol))
        document.cookie = `pair-theme=${preferredTheme || ""}; Path=/; SameSite=Strict; Max-Age=${preferredTheme ? 31536000 : 0}`;
    } catch {
      /* When the browser blocks cookies, the frame keeps the reader's
         choice in memory only. */
    }
    theme();
  });
  systemTheme.addEventListener("change", () => {
    if (preferredTheme) return;
    activeTheme = systemTheme.matches ? "dark" : "light";
    theme();
  });
}
export const charts = new Map();
export const diagrams = new Map();
const diffs = new Map();
const diffLineSets = new Map();
const noteHighlightCSS =
  "::highlight(plan-note), ::highlight(plan-preview) { background-color: var(--mark); color: inherit; }";
// renders contains the renderers in flight, so a re-render of the page can
// restore the scroll position once the content has its height back.
export const renders = new Set();
export function track(task) {
  renders.add(task);
  task.finally(() => renders.delete(task)).catch(() => {});
  return task;
}
export const syntaxThemes = { light: "github-light", dark: "github-dark" };

/* diffHeight() computes the height that @pierre/diffs 1.6.2 gives a diff
   drawn from a patch alone, with overflow "scroll", as measured in Chromium
   and WebKit. Each row is 22px, and the rows have 8px of space above and
   below. Before each hunk that does not start at the line after the
   previous hunk, the library draws an "N unmodified lines" separator, 32px
   tall with 8px of space below it, and 8px above it too after a hunk. In
   split view a run of removed lines shares rows with the added lines after
   it, so the run uses as many rows as its longer side.
   "\\ No newline at end of file" uses a row, one for each side it marks in
   unified view. renderDiff() reserves this height as the viewer's
   min-height before the diff draws. */
const DIFF_ROW_PX = 22;
const DIFF_SEPARATOR_PX = 32;
const DIFF_SPACE_PX = 8;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
export function diffHeight(patch, diffStyle = "split") {
  let rows = 0;
  let space = 0;
  let run = { "-": 0, "+": 0, marked: new Set() };
  let previous = null;
  // next is the new file's line after the previous hunk, or null before the
  // first hunk.
  let next = null;
  const endRun = () => {
    const { marked } = run;
    rows +=
      diffStyle === "split"
        ? Math.max(run["-"], run["+"]) + Math.min(marked.size, 1)
        : run["-"] + run["+"] + marked.size;
    run = { "-": 0, "+": 0, marked: new Set() };
  };
  for (const line of patch.split("\n")) {
    const hunk = HUNK_HEADER.exec(line);
    if (hunk) {
      endRun();
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      // A hunk with no new lines begins after its start line.
      const first = count ? start : start + 1;
      if (first > (next ?? 1))
        space += DIFF_SEPARATOR_PX + DIFF_SPACE_PX * (next === null ? 1 : 2);
      next = first + count;
    } else if (next === null) continue;
    else if (line[0] === "-" || line[0] === "+") run[line[0]] += 1;
    else if (line[0] === " ") {
      endRun();
      rows += 1;
    } else if (line[0] === "\\") {
      if (previous === " ") rows += 1;
      else if (previous) run.marked.add(previous);
    }
    previous = line[0];
  }
  endRun();
  if (next !== null) space += 2 * DIFF_SPACE_PX;
  return rows * DIFF_ROW_PX + space;
}
export function theme() {
  document.documentElement.dataset.theme = activeTheme;
  for (const button of $("theme").querySelectorAll("[data-theme]"))
    button.setAttribute(
      "aria-checked",
      String(button.dataset.theme === (preferredTheme || "system")),
    );
  for (const chart of charts.values())
    chart.setOption({
      color: chartPalette(),
      ...chartTheme(chart.getOption()),
    });
  for (const viewer of diffs.values()) {
    viewer.setOptions({ ...viewer.options, theme: syntaxThemes[activeTheme] });
    viewer.rerender();
  }
  // A preview page reads the theme cookie when it loads, so theme() reloads
  // each preview.
  for (const frame of document.querySelectorAll(".agreement-preview iframe"))
    frame.contentWindow?.location.reload();
  // Page scripts can refresh values they computed from the previous theme.
  window.dispatchEvent(new CustomEvent("plan:theme", { detail: activeTheme }));
}
export function disposeRenderers() {
  for (const diagram of diagrams.values()) diagram.destroy();
  diagrams.clear();
  for (const chart of charts.values()) chart.dispose();
  charts.clear();
  clearDiffs();
}

export { libraries };
const scripts = new Map();
let diffsTask;
let peleTask;
export function pele() {
  peleTask ||= import(libraries.pele).catch((error) => {
    peleTask = undefined;
    throw error;
  });
  return peleTask;
}
// A token has both themes' values in light-dark(), and only an element's
// computed style resolves light-dark(), so color() reads the token from a
// probe element.
export function color(name) {
  const probe = document.createElement("i");
  probe.style.color = `var(${name})`;
  document.body.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}
const chartPalette = () =>
  ["--accent", "--attention", "--ok", "--danger", "--muted"].map(color);
export function script(url, integrity, css = false) {
  if (scripts.has(url)) return scripts.get(url);
  const task = new Promise((resolve, reject) => {
    const element = document.createElement(css ? "link" : "script");
    if (css) {
      element.rel = "stylesheet";
      element.href = url;
    } else element.src = url;
    element.integrity = integrity;
    element.crossOrigin = "anonymous";
    element.onload = resolve;
    element.onerror = () =>
      reject(Error("Renderer unavailable; source preserved."));
    document.head.append(element);
  });
  scripts.set(url, task);
  return task;
}
export function failed(element, error) {
  if (
    !element.isConnected ||
    element.nextElementSibling?.classList.contains("renderer-error")
  )
    return;
  const message = error.message || "Renderer unavailable; source preserved.";
  // A parser's message can quote the source line and put a caret under the
  // column, which is readable only with its line breaks in fixed-width text.
  const note = document.createElement(message.includes("\n") ? "pre" : "p");
  note.className = "renderer-error";
  note.textContent = message;
  element.after(note);
}
export function figure(
  element,
  { title, meta, actions = [], caption, kind = "" },
) {
  if (element.parentElement?.classList.contains("figure-body"))
    return element.parentElement.parentElement;
  const wrapper = document.createElement("figure");
  wrapper.className = `figure ${kind}`.trim();
  if (title || meta || actions.length) {
    const head = document.createElement("figcaption");
    head.className = "figure-head";
    const name = document.createElement("b");
    name.textContent = title || "";
    const side = document.createElement("span");
    if (meta) side.append(meta);
    side.append(...actions);
    head.append(name, side);
    wrapper.append(head);
  }
  const body = document.createElement("div");
  body.className = "figure-body";
  element.replaceWith(wrapper);
  body.append(element);
  wrapper.append(body);
  if (caption) {
    const line = document.createElement("div");
    line.className = "figure-caption";
    line.textContent = caption;
    wrapper.append(line);
  }
  return wrapper;
}
export function copyButton(read) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn";
  button.textContent = "Copy";
  button.onclick = async () => {
    button.textContent = (await copyText(read())) ? "Copied" : "Copy failed";
    setTimeout(() => (button.textContent = "Copy"), 1500);
  };
  return button;
}
export function handoffLine(line) {
  const row = document.createElement("div");
  row.className = "handoff";
  const code = document.createElement("code");
  code.textContent = line;
  row.append(
    code,
    copyButton(() => line),
  );
  return row;
}
export function readData(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function chartTheme(options) {
  const result = {
    backgroundColor: "transparent",
    textStyle: { color: color("--ink") },
    tooltip: {
      backgroundColor: color("--panel"),
      borderColor: color("--line"),
      textStyle: { color: color("--ink") },
    },
  };
  for (const key of ["xAxis", "yAxis"]) {
    if (!options[key]) continue;
    const axes = Array.isArray(options[key]) ? options[key] : [options[key]];
    result[key] = axes.map(() => ({
      axisLabel: { color: color("--muted") },
      axisLine: { lineStyle: { color: color("--line") } },
      splitLine: { lineStyle: { color: color("--line") } },
    }));
  }
  return result;
}
export async function chart(element, options) {
  await script(
    libraries.echarts,
    "sha384-F07Cpw5v8spSU0H113F33m2NQQ/o6GqPTnTjf45ssG4Q6q58ZwhxBiQtIaqvnSpR",
  );
  if (!element.isConnected) return null;
  let instance = charts.get(element);
  if (!instance) {
    instance = window.echarts.init(element, null, { renderer: "svg" });
    charts.set(element, instance);
  }
  instance.setOption(
    {
      backgroundColor: "transparent",
      color: chartPalette(),
      textStyle: { color: color("--ink") },
      ...options,
    },
    true,
  );
  instance.setOption(chartTheme(options));
  return instance;
}
function clearDiffs() {
  for (const viewer of diffs.values()) viewer.cleanUp();
  diffs.clear();
  diffLineSets.clear();
}
export function diff(element, input, options) {
  return track(renderDiff(element, input, options));
}
function composedParent(node) {
  const root = node?.getRootNode?.();
  return node?.parentElement || root?.host || null;
}
function viewerForNode(node) {
  for (
    let at = node?.nodeType === 1 ? node : node?.parentElement;
    at;
    at = composedParent(at)
  ) {
    const viewer = diffs.get(at);
    if (viewer) return viewer;
  }
  return null;
}
export function diffLineForNode(node) {
  if (!viewerForNode(node)) return null;
  let line = node?.nodeType === 1 ? node : node?.parentElement;
  for (; line; line = composedParent(line))
    if (line.matches?.("[data-line][data-line-type]")) break;
  if (!line) return null;
  const side =
    line.dataset.lineType === "change-deletion" ? "deletions" : "additions";
  const lineNumber = Number(
    side === "additions" && line.dataset.lineType === "context"
      ? (line.dataset.altLine ?? line.dataset.line)
      : line.dataset.line,
  );
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return null;
  return {
    side,
    lineNumber,
  };
}
/* Chrome reports a selection made inside a diff's shadow root as anchored
   at the element around the shadow host, so diffSelectionRange() takes the
   range inside the diff from getComposedRanges. It returns null for a
   selection outside a diff. */
export function diffSelectionRange(selection) {
  const anchor = selection?.anchorNode;
  if (!anchor || !selection.getComposedRanges || !viewerForNode(anchor))
    return null;
  const element = anchor.nodeType === 1 ? anchor : anchor.parentElement;
  const shadowRoots = [...element.querySelectorAll("*")]
    .map((node) => node.shadowRoot)
    .filter(Boolean);
  if (!shadowRoots.length) return null;
  return selection.getComposedRanges({ shadowRoots })[0] ?? null;
}
export function selectionAnchor(selection) {
  return diffSelectionRange(selection)?.startContainer ?? selection?.anchorNode;
}
export function isDiffNode(node) {
  return Boolean(viewerForNode(node));
}
export function diffForTarget(target) {
  const block =
    typeof target === "string" ? document.getElementById(target) : target;
  if (!block) return null;
  return [...diffs.keys()].find((element) => block.contains(element)) || null;
}
export function diffViews(root) {
  return [...diffs.keys()].filter((element) => root.contains(element));
}
function threadSlot({ side, lineNumber }) {
  return `pair-line-${side}-${lineNumber}`;
}
export function setDiffThreads(element, threads, cards) {
  const viewer = diffs.get(element);
  const container = element.querySelector(":scope > diffs-container");
  if (!viewer?.setLineAnnotations || !container) return false;
  const lines = new Map();
  const cardsByLine = new Map();
  for (const thread of threads) {
    const line = thread.diffLine;
    if (
      !line ||
      !["additions", "deletions"].includes(line.side) ||
      !Number.isInteger(line.lineNumber) ||
      line.lineNumber < 1
    )
      continue;
    const slot = threadSlot(line);
    lines.set(slot, line);
    const card = cards.get(thread.id)?.card;
    if (!card) continue;
    card.removeAttribute("slot");
    cardsByLine.set(slot, [...(cardsByLine.get(slot) || []), card]);
  }
  const annotations = [...lines.values()];
  const signature = [...lines.keys()].sort().join("|");
  if (diffLineSets.get(element) !== signature) {
    viewer.setLineAnnotations(annotations);
    viewer.rerender();
    diffLineSets.set(element, signature);
  }
  for (const [key, lineCards] of cardsByLine) {
    const name = viewer.getAnnotationSlotName(lines.get(key));
    const wrapper = [...container.children].find(
      (node) => node.hasAttribute("data-annotation-slot") && node.slot === name,
    );
    wrapper?.querySelector("[data-pair-thread-line]")?.remove();
    wrapper?.append(...lineCards);
  }
  return true;
}
async function renderDiff(
  element,
  input,
  { diffStyle = "split", wrap = false } = {},
) {
  if (typeof input.patch !== "string") throw Error("A Git patch is required.");
  if (!input.patch) {
    element.textContent = "No changes.";
    return null;
  }
  // renderDiff() sets the min-height before the first await, so the box has
  // the diff's height before the page paints, and the diff draws into it
  // without moving anything. A wrapped line is taller than one row, so a
  // wrapped diff can only grow past this minimum.
  element.style.minHeight = `${diffHeight(input.patch, diffStyle)}px`;
  diffsTask ||= import(libraries.diffs);
  const { FileDiff, parsePatchFiles } = await diffsTask;
  // Once the library has loaded, the await above resumes in a microtask,
  // and the browser paints only after every microtask has run. Waiting for
  // a task gives each diff a task of its own, so the page paints first.
  await new Promise((resolve) => setTimeout(resolve));
  if (!element.isConnected) return null;
  const overflow = wrap ? "wrap" : "scroll";
  let viewer = diffs.get(element);
  if (viewer) {
    viewer.setOptions({ ...viewer.options, diffStyle, overflow });
    viewer.rerender();
    return viewer;
  }
  const files = parsePatchFiles(input.patch).flatMap((patch) => patch.files);
  if (files.length !== 1)
    throw Error("Each diff component requires one file pair.");
  // The bar above the viewer shows the file name, and the viewer's own header
  // would repeat it with the path the patch was made from.
  viewer = new FileDiff({
    theme: syntaxThemes[activeTheme],
    diffStyle,
    lineDiffType: "word-alt",
    diffIndicators: "classic",
    // Unless the page sets wrap, a long line scrolls sideways, so every row
    // is one line tall and diffHeight() matches the diff's height.
    overflow,
    disableFileHeader: true,
    unsafeCSS: noteHighlightCSS,
    onPostRender(_node, _viewer, phase) {
      if (phase !== "unmount")
        queueMicrotask(() => window.dispatchEvent(new Event("plan:diff")));
    },
    renderAnnotation(annotation) {
      const placeholder = document.createElement("span");
      placeholder.dataset.pairThreadLine = threadSlot(annotation);
      return placeholder;
    },
  });
  element.replaceChildren();
  viewer.render({ fileDiff: files[0], containerWrapper: element });
  diffs.set(element, viewer);
  diffLineSets.set(element, "");
  return viewer;
}
