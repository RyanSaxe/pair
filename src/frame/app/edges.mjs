/* installEdges() runs the three grips, which set the page's width and the
   sidebar's. The frame saves one value in each browser for every session on the
   hub, as it does for pair:sidebar. The script in shell.html's head reads the
   same keys, with the same ranges, and sets the same variables before the first
   paint. shell.css draws the grips and reads the variables. */
const pageEdge = {
  key: "pair:page-width",
  variable: "--page-width",
  rest: 1160,
};
const sidebarEdge = {
  key: "pair:sidebar-width",
  variable: "--sidebar-saved",
  rest: 224,
};
const SIDEBAR_WIDEST = 400;
const SNAP_PX = 24;
// A tab is 3px wide, and the page's left edge rounds down, so a page leaves room
// for both tabs outside its lines only when the window is 6px wider.
const TAB_ROOM_PX = 6;

const clamped = (width, min, max) =>
  Math.min(max, Math.max(min, Math.round(width)));

/* The page stays centered, so its width is twice the pointer's distance from
   the window's center. A pointer can't reach a window's last pixel, so near
   the window's edge the page takes the whole window. */
export function pageWidthAt(x, windowWidth) {
  if (x <= SNAP_PX || x >= windowWidth - SNAP_PX) return windowWidth;
  return clamped(2 * Math.abs(x - windowWidth / 2), pageEdge.rest, windowWidth);
}
export const sidebarWidthAt = (x, bodyLeft) =>
  clamped(x - bodyLeft, sidebarEdge.rest, SIDEBAR_WIDEST);
export function readWidth(value, min, max) {
  const width = Number(value);
  return Number.isInteger(width) && width >= min && width <= max ? width : null;
}

function savedPageWidth() {
  try {
    return readWidth(
      localStorage.getItem(pageEdge.key),
      pageEdge.rest + 1,
      Infinity,
    );
  } catch {
    return null;
  }
}
function save({ key, rest }, width) {
  try {
    if (width === rest) localStorage.removeItem(key);
    else localStorage.setItem(key, String(width));
  } catch {
    /* When localStorage throws, the width applies until the next load. */
  }
}
function apply({ variable, rest }, width) {
  const { style } = document.documentElement;
  if (width === rest) style.removeProperty(variable);
  else style.setProperty(variable, `${width}px`);
}

function installGrip(grip, kind, edge, widthAt, setWidth) {
  const root = document.documentElement;
  grip.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    grip.classList.add("active");
    root.dataset.edgeDrag = kind;
    // A double-click presses twice, so a press with no movement writes nothing.
    let width = null;
    const move = ({ clientX }) => {
      if (width === null && clientX === event.clientX) return;
      width = widthAt(clientX);
      setWidth(width);
    };
    grip.addEventListener("pointermove", move);
    // The browser ends the capture on a release and on a cancelled pointer.
    grip.addEventListener(
      "lostpointercapture",
      () => {
        grip.removeEventListener("pointermove", move);
        grip.classList.remove("active");
        delete root.dataset.edgeDrag;
        if (width !== null) save(edge, width);
      },
      { once: true },
    );
  });
  grip.addEventListener("dblclick", () => {
    // A reset moves the column at once too, as a drag does. Reading the layout
    // applies the new width before the root loses data-edge-drag, which turns
    // the delay on the column's margin back on.
    root.dataset.edgeDrag = kind;
    setWidth(edge.rest);
    root.getBoundingClientRect();
    delete root.dataset.edgeDrag;
    save(edge, edge.rest);
  });
}

export function installEdges() {
  const root = document.documentElement;
  let pageWidth = savedPageWidth() ?? pageEdge.rest;
  const syncFull = () =>
    root.toggleAttribute(
      "data-page-full",
      innerWidth - pageWidth < TAB_ROOM_PX,
    );
  const setPageWidth = (width) => {
    pageWidth = width;
    apply(pageEdge, width);
    syncFull();
  };
  syncFull();
  addEventListener("resize", syncFull);
  for (const side of ["left", "right"])
    installGrip(
      document.querySelector(`.grip.${side}`),
      "page",
      pageEdge,
      (x) => pageWidthAt(x, innerWidth),
      setPageWidth,
    );
  const body = document.querySelector(".app-body");
  installGrip(
    document.querySelector(".grip.side"),
    "side",
    sidebarEdge,
    (x) => sidebarWidthAt(x, body.getBoundingClientRect().left),
    (width) => apply(sidebarEdge, width),
  );
}
