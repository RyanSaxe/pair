// Three columns at the reading width are about 260px each. Narrow material such
// as mocks fits in a column, and wider material needs tabs.
const minimumColumn = 240;
function initialize(section, { page, planUI }) {
  const options = Array.from(
    section.querySelectorAll(":scope > .visual-option[data-value]"),
  );
  if (!options.length) return;
  const prefs = planUI.prefs;
  // The key includes the page ID, so planUI.prefs stores a separate layout for
  // one decision ID on two pages.
  const key = `visual-decision:${page.id}/${section.id || section.dataset.choice}`;
  const head = document.createElement("div");
  head.className = "vd-head";
  const heading = section.querySelector(":scope > h3");
  if (heading) head.append(heading);
  const layout = document.createElement("span");
  layout.className = "vd-layout";
  layout.setAttribute("role", "group");
  layout.setAttribute("aria-label", "Layout");
  for (const [value, label] of [
    ["tabs", "Tabs"],
    ["columns", "Side by side"],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.vdLayout = value;
    button.textContent = label;
    layout.append(button);
  }
  head.append(layout);
  section.prepend(head);
  // A new button replaces the article's header as the radio control and gets
  // the article's data-value, so the frame reads the choice from the button.
  // setup moves the value on the article to data-option.
  for (const article of options) {
    const value = article.dataset.value;
    const label = article.dataset.label || value;
    delete article.dataset.value;
    article.dataset.option = value;
    const header = article.querySelector(":scope > header");
    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "vd-pick";
    pick.dataset.value = value;
    pick.dataset.label = label;
    // The frame may have restored the draft onto the article before this setup
    // ran, so the radio control copies the article's aria-pressed.
    pick.setAttribute(
      "aria-pressed",
      article.getAttribute("aria-pressed") || "false",
    );
    article.removeAttribute("aria-pressed");
    if (header) {
      pick.append(...header.childNodes);
      header.replaceWith(pick);
    } else {
      pick.textContent = label;
      article.prepend(pick);
    }
  }
  const columns = document.createElement("div");
  columns.className = "vd-columns";
  columns.style.setProperty("--vd-count", String(options.length));
  columns.append(...options);
  const tabs = document.createElement("div");
  tabs.className = "vd-tablist";
  tabs.setAttribute("role", "tablist");
  const tabFor = new Map();
  for (const article of options) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.dataset.vdTab = article.dataset.option;
    tab.textContent = article.querySelector(".vd-pick").dataset.label;
    tabs.append(tab);
    tabFor.set(article.dataset.option, tab);
  }
  const box = document.createElement("div");
  box.className = "vd-box";
  box.append(tabs, columns);
  section.append(box);
  let active = options[0].dataset.option;
  let viewed = false;
  const chosen = () =>
    options.find(
      (article) =>
        article.querySelector(".vd-pick").getAttribute("aria-pressed") ===
        "true",
    )?.dataset.option || null;
  function sync() {
    const mode = section.dataset.mode;
    const picked = chosen();
    if (mode === "tabs" && picked && !viewed) active = picked;
    for (const article of options)
      article.hidden = mode === "tabs" && article.dataset.option !== active;
    for (const [value, tab] of tabFor) {
      const selected = value === active;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.classList.toggle("chosen", value === picked);
    }
    for (const button of layout.querySelectorAll("[data-vd-layout]"))
      button.classList.toggle("current", button.dataset.vdLayout === mode);
  }
  // applyLayout() shows tabs unless the reviewer chose side by side and every
  // column would be at least minimumColumn wide. A narrow window falls back to
  // tabs, and the columns come back when there is room again.
  function applyLayout() {
    let mode = prefs.get(key) || "tabs";
    if (
      mode !== "columns" ||
      section.clientWidth / options.length < minimumColumn
    )
      mode = "tabs";
    section.dataset.mode = mode;
    sync();
  }
  tabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-vd-tab]");
    if (!tab) return;
    active = tab.dataset.vdTab;
    viewed = true;
    sync();
  });
  tabs.addEventListener("keydown", (event) => {
    const list = Array.from(tabFor.values());
    const index = list.indexOf(event.target);
    if (index < 0) return;
    let next;
    if (event.key === "ArrowLeft")
      next = (index - 1 + list.length) % list.length;
    if (event.key === "ArrowRight") next = (index + 1) % list.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = list.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    list[next].focus();
    list[next].click();
  });
  layout.addEventListener("click", (event) => {
    const button = event.target.closest("[data-vd-layout]");
    if (!button) return;
    prefs.set(key, button.dataset.vdLayout);
    applyLayout();
  });
  new MutationObserver(sync).observe(section, {
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-pressed"],
  });
  new ResizeObserver(applyLayout).observe(section);
  applyLayout();
}
planUI.define("visual-decision", {
  match: ".visual-decision[data-choice]",
  setup: initialize,
});
