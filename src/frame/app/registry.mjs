import { define, enhance } from "#frame/app/components.mjs";
import { prefs } from "#frame/app/store.mjs";
import { $ } from "#frame/app/util.mjs";
import { mode, page } from "#frame/app/view.mjs";
import { drawingAnswer, recordAnswer } from "#frame/notes/controls.mjs";
import { openDrawing } from "#frame/notes/drawing.mjs";
import { openNote } from "#frame/notes/notes.mjs";
import { chart, charts, diff, pele } from "#frame/pages/renderers.mjs";
import { drawProposal } from "#frame/pages/work.mjs";

// Component behaviors use these names without importing them. The page's
// module script imports them from this module before the behaviors run.
export { $, uuid } from "#frame/app/util.mjs";
export { linkButton } from "#frame/app/ui.mjs";
export { base, online, page, pages, plan } from "#frame/app/view.mjs";
export { canComment, commentOn } from "#frame/notes/blocks.mjs";
export { canSketch, openSketch } from "#frame/notes/drawing.mjs";
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
