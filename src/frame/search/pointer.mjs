const AIM_PX = 4;
const AIM_SLOPE = 2;
const REST_MS = 120;

/* A row follows the pointer, except while the pointer heads right, for the
   preview and Open, across rows the reader isn't choosing. A pointer that stops
   selects the row under it. Each move is measured from where the last one ended,
   and the browser reports a move with no distance when a list redraws under a
   resting pointer, so that pointer leaves the keyboard's selection alone. */
export function followPointer(list, { paused, select }) {
  let aim = null;
  let rest = 0;
  const reset = () => {
    aim = null;
    clearTimeout(rest);
  };
  list.addEventListener("mousemove", (event) => {
    if (paused()) return;
    const here = { x: event.clientX, y: event.clientY };
    const dx = here.x - (aim?.x ?? here.x);
    const dy = here.y - (aim?.y ?? here.y);
    aim ||= here;
    if (Math.abs(dx) + Math.abs(dy) < AIM_PX) return;
    aim = here;
    clearTimeout(rest);
    const row = event.target.closest(".search-row");
    if (!row) return;
    const follow = () => row.isConnected && select(Number(row.dataset.i));
    if (dx > 0 && Math.abs(dy) < dx * AIM_SLOPE)
      rest = setTimeout(follow, REST_MS);
    else follow();
  });
  list.addEventListener("mouseleave", reset);
  return { reset };
}
