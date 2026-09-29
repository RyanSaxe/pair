import { prefs } from "#frame/app/store.mjs";
import { $ } from "#frame/app/util.mjs";
import { mode, page } from "#frame/app/view.mjs";
import { drawingAnswer, recordAnswer } from "#frame/notes/controls.mjs";
import { openDrawing } from "#frame/notes/drawing.mjs";
import { openNote } from "#frame/notes/notes.mjs";
import { chart, charts, diff, failed, track } from "#frame/pages/renderers.mjs";

// The names component behaviors use without importing them. The page's
// module script imports them from here before the behaviors run.
export { $, uuid } from "#frame/app/util.mjs";
export { base, online, page, pages, plan } from "#frame/app/view.mjs";
export { linkButton } from "#frame/pages/agreed.mjs";
export { show } from "#frame/pages/pages.mjs";
export { lineRanges } from "#shared/lines.mjs";
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
export function enhance(root) {
  for (const [name, { match, setup }] of registry) {
    for (const element of root.querySelectorAll(match)) {
      if (element.dataset.ready === name) continue;
      element.dataset.ready = name;
      try {
        const task = setup(element, { page, planUI: window.planUI });
        if (task instanceof Promise)
          track(task).catch((error) => failed(element, error));
      } catch (error) {
        failed(element, error);
      }
    }
  }
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
