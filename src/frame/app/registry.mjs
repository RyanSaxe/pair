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
  pele,
  track,
} from "#frame/pages/renderers.mjs";
import { drawProposal } from "#frame/pages/work.mjs";

// Component behaviors use these names without importing them. The page's
// module script imports them from this module before the behaviors run.
export { $, uuid } from "#frame/app/util.mjs";
export { base, online, page, pages, plan } from "#frame/app/view.mjs";
export { canComment, commentOn } from "#frame/notes/blocks.mjs";
export { canSketch, openSketch } from "#frame/notes/drawing.mjs";
export { linkButton } from "#frame/pages/agreed.mjs";
export { diagramBox } from "#frame/pages/diagram.mjs";
export { show } from "#frame/pages/pages.mjs";
export { lineRanges } from "#shared/lines.mjs";
export {
  color,
  diagrams,
  copyButton,
  failed,
  figure,
  libraries,
  readData,
  script,
  syntaxThemes,
} from "#frame/pages/renderers.mjs";

/* The frame renders a page by replacing #page-content, so enhance() runs
   each setup again on every visit. A setup rebuilds its state from
   planUI.prefs instead of keeping it between visits. */
const registry = new Map();
function define(name, { match, setup }) {
  registry.set(name, { match, setup });
}
/* enhance() prints one component's failure in place and leaves the rest of
   the page rendered. A setup returns a promise when its element's height is
   final only after the promise settles, as a diagram's setup does. enhance()
   tracks each such promise, so the frame restores the scroll position only
   after the content has its height. enhance() returns a promise that
   settles with every such setup, or null when there is none, so show() can
   wait for them before the page appears. */
export function enhance(root) {
  const sizing = [];
  for (const [name, { match, setup }] of registry) {
    for (const element of root.querySelectorAll(match)) {
      if (element.dataset.ready === name) continue;
      element.dataset.ready = name;
      try {
        const task = setup(element, { page, planUI: window.planUI });
        if (task instanceof Promise)
          sizing.push(track(task).catch((error) => failed(element, error)));
      } catch (error) {
        failed(element, error);
      }
    }
  }
  return sizing.length ? Promise.all(sizing) : null;
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
    answered: drawingAnswer,
    draw: openDrawing,
    chart,
    pele,
    define,
    diff,
    proposal: drawProposal,
    comment: (anchor, quote = "") =>
      openNote({ topic: page.id, anchor, quote }),
    enhance,
    prefs,
    mode,
    page: null,
  };
}
