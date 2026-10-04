import { $ } from "#frame/app/util.mjs";

/* The first header button opens and closes the sidebar at every width.
   Above 720px the sidebar starts open, closing it gives the page the
   frame's full width, and this browser keeps the choice for every session
   on the hub. At 720px and below it starts closed and slides over the
   page, and choosing a page, tapping the dimmed page or Escape closes it.
   shell.css draws both from the root's data-sidebar, which the script in
   shell.html's head sets before the first paint. */
const storageKey = "pair:sidebar";
let narrow;
const root = () => document.documentElement;
const isOpen = () => root().dataset.sidebar === "open";
function savedOpen() {
  try {
    return localStorage.getItem(storageKey) !== "closed";
  } catch {
    return true;
  }
}
export function setSidebar(open) {
  root().dataset.sidebar = open ? "open" : "closed";
  $("sidebar-toggle").setAttribute("aria-expanded", String(open));
  // Focus left inside a hidden sidebar would be lost.
  if (!open && $("sidebar").contains(document.activeElement))
    $("sidebar-toggle").focus();
  if (narrow.matches) return;
  try {
    if (open) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, "closed");
  } catch {
    /* The sidebar still opens and closes; the next load starts open. */
  }
}
// Every page change and every closing menu closes the sidebar where it
// covers the page. Above 720px it stays as the reader left it.
export function closeSidebarOverPage() {
  if (narrow?.matches && isOpen()) setSidebar(false);
}
export function openSidebar() {
  setSidebar(true);
}
export function installSidebar() {
  narrow = matchMedia("(max-width: 720px)");
  const place = () => setSidebar(!narrow.matches && savedOpen());
  place();
  narrow.addEventListener("change", place);
  $("sidebar-toggle").addEventListener("click", () => setSidebar(!isOpen()));
  $("sidebar-scrim").addEventListener("click", () => setSidebar(false));
}
