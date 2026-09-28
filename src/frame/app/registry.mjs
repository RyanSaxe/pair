import { scroller } from "#frame/app/places.mjs";
import { prefs } from "#frame/app/store.mjs";
import { $ } from "#frame/app/util.mjs";
import { mode, page } from "#frame/app/view.mjs";
import { drawingAnswer, recordAnswer } from "#frame/notes/controls.mjs";
import { openDrawing } from "#frame/notes/drawing.mjs";
import { openNote } from "#frame/notes/notes.mjs";
import {
  chart,
  charts,
  diff,
  failed,
  libraries,
  renders,
  track,
} from "#frame/pages/renderers.mjs";

// The names component behaviors use without importing them. The page's
// module script imports them from here before the behaviors run.
export { $, uuid } from "#frame/app/util.mjs";
export { base, online, page, pages, plan } from "#frame/app/view.mjs";
export { linkButton } from "#frame/pages/agreed.mjs";
export { show } from "#frame/pages/pages.mjs";
export {
  color,
  copyButton,
  failed,
  figure,
  libraries,
  readData,
  script,
  syntaxThemes,
} from "#frame/pages/renderers.mjs";

/* Components. A component is a named markup contract and the setup that
   turns an element carrying it into the rendered thing. define() records
   one; enhance() runs every registration over a page. A page renders by
   replacing #page-content, so setup runs again on every visit and rebuilds
   its state from planUI.prefs rather than holding it. */
const registry = new Map();
function define(name, { match, setup }) {
  registry.set(name, { match, setup });
}
/* One component's failure prints in place and leaves the rest of the page
   rendered. A setup that returns a promise is tracked, so the scroll
   position is restored only once its content has its height. */
function start(element, setup) {
  try {
    const task = setup(element, { page, planUI: window.planUI });
    if (task instanceof Promise)
      track(task).catch((error) => failed(element, error));
  } catch (error) {
    failed(element, error);
  }
}
/* Figures render one at a time after the page paints, nearest to the view
   first. The queue maps each figure that has not started rendering to its
   component's name and setup. */
const figures = new Set([
  "code",
  "diagram",
  "chart",
  "before-after",
  "formula",
]);
const queue = new Map();
let pumping = false;
/* The names in libraries of the modules each kind of figure imports.
   enhance() starts loading them as the page renders, and the pump starts a
   figure only once they have loaded, so a figure whose library is still
   downloading does not hold up the figures after it. A chart and a formula
   load their library in their setup, with a script element and its hash. */
const imports = {
  code: ["shiki"],
  "before-after": ["diffs"],
  diagram: ["mermaid", "elk"],
};
const loads = new Map();
const loaded = new Set();
function load(library) {
  if (!loads.has(library))
    loads.set(
      library,
      import(libraries[library])
        .catch(() => {})
        .finally(() => loaded.add(library)),
    );
}
const ready = (name) =>
  (imports[name] || []).every((library) => loaded.has(library));
/* The pump's current wait: for a figure's render, or for a library when
   element is null. enhance() ends the wait once that figure has been
   replaced, or whenever it adds figures during a wait for a library. */
let waiting = null;
function wait(element, task) {
  return new Promise((resolve) => {
    waiting = { element, resolve };
    task.then(resolve);
  }).finally(() => (waiting = null));
}
// How far a box is from the scroller's visible box, in pixels. A figure
// with no box, such as one in a closed <details>, is the farthest.
function distance(box, view) {
  if (!box.width && !box.height) return Infinity;
  if (box.bottom < view.top) return view.top - box.bottom;
  if (box.top > view.bottom) return box.top - view.bottom;
  return 0;
}
// The nearest figure whose libraries have loaded, and the higher one of two
// at the same distance, such as two figures on screen.
function nearest() {
  const view = scroller().getBoundingClientRect();
  let best = null;
  for (const [element, { name }] of queue) {
    if (!element.isConnected) queue.delete(element);
    else if (ready(name)) {
      const box = element.getBoundingClientRect();
      const away = distance(box, view);
      if (
        !best ||
        away < best.away ||
        (away === best.away && box.top < best.top)
      )
        best = { element, away, top: box.top };
    }
  }
  return best;
}
/* A diff's box has no height before it renders, so reserve() sets one from
   its patch: about 20 px for each row the viewer shows. A chart's body is
   its options as JSON until its setup clears it, so reserve() hides the
   chart until then. */
function reserve(element, name) {
  if (name === "chart") element.style.visibility = "hidden";
  if (name !== "before-after") return;
  try {
    const input = element.querySelector("[data-diff-input]");
    const rows = JSON.parse(input.value)
      .patch.split("\n")
      .filter((line) => /^[ +\-@]/.test(line) && !/^(\+\+\+|---)/.test(line));
    element.querySelector(".change-view").style.minHeight =
      `${rows.length * 20}px`;
  } catch {
    /* The component reports a patch it cannot read. */
  }
}
async function pump() {
  pumping = true;
  try {
    // The page paints before the first figure renders.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    while (queue.size) {
      const next = nearest();
      if (!next) {
        const pending = [...loads]
          .filter(([library]) => !loaded.has(library))
          .map(([, task]) => task);
        if (!pending.length) break;
        await wait(null, Promise.race(pending));
        continue;
      }
      /* The pump waits for a new task before each figure, so the browser
         paints and handles input between two figures. Before a figure more
         than two screens away, it waits for idle time instead, in a browser
         that has requestIdleCallback. */
      await new Promise((resolve) =>
        next.away > 2 * innerHeight && window.requestIdleCallback
          ? requestIdleCallback(resolve, { timeout: 300 })
          : setTimeout(resolve),
      );
      const { element } = next;
      const entry = queue.get(element);
      if (!entry || !element.isConnected) continue;
      queue.delete(element);
      if (entry.name === "chart") element.style.removeProperty("visibility");
      // The renders the setup starts. The diff component's setup starts its
      // renderer without returning it, so its result alone is not enough.
      const before = new Set(renders);
      start(element, entry.setup);
      const started = [...renders].filter((task) => !before.has(task));
      await wait(element, Promise.allSettled(started));
      element.querySelector(".change-view")?.style.removeProperty("min-height");
    }
  } finally {
    pumping = false;
  }
}
/* enhance() sets up every component but a figure as the page renders. It
   adds each figure to the queue and starts loading the libraries it
   imports. */
export function enhance(root) {
  for (const [name, { match, setup }] of registry) {
    for (const element of root.querySelectorAll(match)) {
      if (element.dataset.ready === name) continue;
      element.dataset.ready = name;
      if (!figures.has(name)) {
        start(element, setup);
        continue;
      }
      reserve(element, name);
      queue.set(element, { name, setup });
      for (const library of imports[name] || []) load(library);
    }
  }
  if (waiting && !waiting.element?.isConnected) waiting.resolve();
  // The pump is tracked, so the scroll position is restored and the notes'
  // marks are placed once every queued figure has rendered.
  if (queue.size && !pumping) track(pump());
}
export function installRegistry() {
  new ResizeObserver(() => {
    for (const instance of charts.values()) instance.resize();
  }).observe($("page-content"));
}
export function createPlanUI() {
  return {
    answer: recordAnswer,
    drawing: drawingAnswer,
    // Whether the draft has an answer for a question on this page.
    answered: (id) => Boolean(drawingAnswer(id)),
    draw: openDrawing,
    chart,
    define,
    diff,
    comment: (anchor, quote = "") => openNote(page.id, anchor, quote),
    enhance,
    prefs,
    mode,
    page: null,
  };
}
