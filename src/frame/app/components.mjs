import { page } from "#frame/app/view.mjs";
import { failed, track } from "#frame/pages/renderers.mjs";

/* The frame renders a page by replacing #page-content, so enhance() runs
   each setup again on every visit. A setup rebuilds its state from
   planUI.prefs instead of keeping it between visits. */
const registry = new Map();

export function define(name, { match, setup }) {
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
        if (task instanceof Promise) {
          sizing.push(track(task).catch((error) => failed(element, error)));
        }
      } catch (error) {
        failed(element, error);
      }
    }
  }
  return sizing.length ? Promise.all(sizing) : null;
}
