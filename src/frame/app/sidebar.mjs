import { $ } from "#frame/app/util.mjs";

/* Above 720px the frame saves whether the sidebar is open under one key for
   every session on the hub. At 720px and below the sidebar starts closed
   and covers the page. shell.css styles both from the root's data-sidebar
   attribute, which the script in shell.html's head sets before the first
   paint. */
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
  // Focus left inside a hidden sidebar would be lost, so setSidebar() moves
  // it to the toggle.
  if (!open && $("sidebar").contains(document.activeElement))
    $("sidebar-toggle").focus();
  if (narrow.matches) return;
  try {
    if (open) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, "closed");
  } catch {
    /* When localStorage throws, the sidebar still opens and closes, and the
       next load starts open. */
  }
}
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
