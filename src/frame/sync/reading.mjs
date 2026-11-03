/* A reply or a card's title that stays whole on screen for 1.5 seconds has been
   read. It counts only while the reviewer can be reading it: the tab has focus, and
   no dialog covers the page. A subpixel offset can keep a line just under whole. */
const STAY_MS = 1500;
const CHECK_MS = 250;
const WHOLE = 0.99;
const looking = () =>
  document.hasFocus() && !document.querySelector("dialog[open]");

// watchReading returns watch(list), which takes the { node, id } pairs to watch
// from now on, and calls onRead(id) for each one that the reviewer reads.
export function watchReading(onRead) {
  const watched = new Map();
  let observer = null;
  let timer = 0;
  function check() {
    timer = 0;
    const now = performance.now();
    for (const [node, entry] of watched) {
      if (entry.since === null) continue;
      if (!looking()) entry.since = now;
      else if (now - entry.since >= STAY_MS) {
        observer.unobserve(node);
        watched.delete(node);
        onRead(entry.id);
        continue;
      }
      timer ||= setTimeout(check, CHECK_MS);
    }
  }
  const seen = (entries) => {
    for (const { target, intersectionRatio } of entries) {
      const entry = watched.get(target);
      if (entry)
        entry.since = intersectionRatio >= WHOLE ? performance.now() : null;
    }
    timer ||= setTimeout(check, CHECK_MS);
  };
  return function watch(list) {
    observer ||= new IntersectionObserver(seen, { threshold: [0, WHOLE] });
    const wanted = new Set(list.map(({ node }) => node));
    for (const node of watched.keys())
      if (!wanted.has(node)) {
        observer.unobserve(node);
        watched.delete(node);
      }
    for (const { node, id } of list)
      if (!watched.has(node)) {
        watched.set(node, { id, since: null });
        observer.observe(node);
      }
  };
}
