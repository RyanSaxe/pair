import { $, copyText } from "#frame/app/util.mjs";

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
    /* Theme changes remain available without storage. */
  }
  activeTheme = preferredTheme || (systemTheme.matches ? "dark" : "light");
  $("settings").onclick = () => $("settings-dialog").showModal();
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
      /* Keep the explicit choice in memory when cookies are blocked. */
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
const diffs = new Map();
// In-flight renderers, so a page re-render can restore the scroll position
// once the content has its height back.
export const renders = new Set();
export function track(task) {
  renders.add(task);
  task.finally(() => renders.delete(task)).catch(() => {});
  return task;
}
export const syntaxThemes = { light: "github-light", dark: "github-dark" };
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
  // A preview page reads the theme cookie when it loads.
  for (const frame of document.querySelectorAll(".agreement-preview iframe"))
    frame.contentWindow?.location.reload();
  // A component that bakes a colour into what it drew, rather than reading
  // a token, redraws here. The diagram is the one that does.
  window.dispatchEvent(new CustomEvent("plan:theme", { detail: activeTheme }));
}
export function disposeRenderers() {
  for (const chart of charts.values()) chart.dispose();
  charts.clear();
  clearDiffs();
}

/* Renderers and figures */
export const libraries = {
  shiki: "https://esm.sh/shiki@3.12.2",
  diffs: "https://esm.sh/@pierre/diffs@1.4.2?bundle",
  mermaid:
    "https://cdn.jsdelivr.net/npm/mermaid@11.12.0/dist/mermaid.esm.min.mjs",
  elk: "https://cdn.jsdelivr.net/npm/@mermaid-js/layout-elk@0.2.3/dist/mermaid-layout-elk.esm.min.mjs",
  katex: "https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js",
  katexCss: "https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css",
  echarts: "https://cdn.jsdelivr.net/npm/echarts@6.0.0/dist/echarts.min.js",
};
const scripts = new Map();
let diffsTask;
// A token's colour in the theme on screen. A token holds both themes'
// values in light-dark(), which only an element's style resolves.
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
  const note = document.createElement("p");
  note.className = "renderer-error";
  note.textContent = error.message || "Renderer unavailable; source preserved.";
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
// The line another agent runs to take the session over, with Copy.
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
/* A JSON array in a data attribute, for the components that take one:
   data-notes on a code block, data-terms on a formula. */
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
}
export function diff(element, input, options) {
  return track(renderDiff(element, input, options));
}
async function renderDiff(element, input, { diffStyle = "split" } = {}) {
  if (typeof input.patch !== "string") throw Error("A Git patch is required.");
  if (!input.patch) {
    element.textContent = "No changes.";
    return null;
  }
  diffsTask ||= import(libraries.diffs);
  const { FileDiff, parsePatchFiles } = await diffsTask;
  if (!element.isConnected) return null;
  let viewer = diffs.get(element);
  if (viewer) {
    viewer.setOptions({ ...viewer.options, diffStyle });
    viewer.rerender();
    return viewer;
  }
  const files = parsePatchFiles(input.patch).flatMap((patch) => patch.files);
  if (files.length !== 1)
    throw Error("Each diff component requires one file pair.");
  // The bar above the viewer names the file; the viewer's own header would
  // repeat it with the path the patch was made from.
  viewer = new FileDiff({
    theme: syntaxThemes[activeTheme],
    diffStyle,
    lineDiffType: "word-alt",
    diffIndicators: "classic",
    overflow: "wrap",
    disableFileHeader: true,
  });
  element.replaceChildren();
  viewer.render({ fileDiff: files[0], containerWrapper: element });
  diffs.set(element, viewer);
  return viewer;
}
