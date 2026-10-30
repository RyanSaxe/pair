planUI.define("before-after", {
  match: ".change-review",
  setup(root, { page, planUI }) {
    const viewer = root.querySelector(".change-view");
    const error = root.querySelector("[data-diff-error]");
    const buttons = root.querySelectorAll("[data-diff-style]");
    const wrapButton = root.querySelector("[data-diff-wrap]");
    const controls = root.querySelector(".change-controls");
    if (
      root.dataset.file &&
      controls &&
      !controls.querySelector(".change-file")
    ) {
      const name = document.createElement("b");
      name.className = "change-file";
      name.textContent = root.dataset.file;
      controls.prepend(name);
    }
    const prefs = planUI.prefs;
    // The key uses the element's own ID, so planUI.prefs stores a separate
    // layout for each diff on a page. A diff with no ID uses its position among
    // the page's diffs.
    const index = [
      ...root.closest("#page-content").querySelectorAll(".change-review"),
    ]
      .indexOf(root)
      .toString();
    const name = root.id || index;
    if (!root.id) {
      const base = `pair-diff-${page.id}-${index}`;
      let id = base;
      let suffix = 1;
      while (document.getElementById(id)) id = `${base}-${suffix++}`;
      root.id = id;
    }
    const key = `diff:${page.id}/${name}`;
    const wrapKey = `${key}:wrap`;
    // data-wrap on the section opens the diff wrapped until the reviewer clicks
    // Wrap, and the reviewer's choice then takes precedence.
    const wrapped = () =>
      (prefs.get(wrapKey) ??
        (root.hasAttribute("data-wrap") ? "on" : "off")) === "on";
    // The split view needs room for two columns, so a column narrower than
    // 900px gets the unified view. A click on the toggle overrides the width,
    // and planUI.prefs stores the choice for each diff.
    const automatic = () =>
      (root.closest("#page-content") || document.body).clientWidth >= 900
        ? "split"
        : "unified";
    let input;
    const fail = (reason) => {
      error.textContent = reason.message || "Diff renderer unavailable.";
      error.hidden = false;
    };
    try {
      input = JSON.parse(root.querySelector("[data-diff-input]").value);
      for (const source of root.querySelectorAll("[data-diff-source]"))
        source.textContent = input[source.dataset.diffSource];
    } catch (reason) {
      fail(reason);
      return;
    }
    let style = null;
    const render = async (diffStyle) => {
      style = diffStyle;
      try {
        await planUI.diff(viewer, input, { diffStyle, wrap: wrapped() });
        wrapButton?.setAttribute("aria-pressed", String(wrapped()));
        for (const button of buttons)
          button.setAttribute(
            "aria-pressed",
            String(button.dataset.diffStyle === diffStyle),
          );
      } catch (reason) {
        fail(reason);
      }
    };
    for (const button of buttons)
      button.onclick = () => {
        prefs.set(key, button.dataset.diffStyle);
        render(button.dataset.diffStyle);
      };
    if (wrapButton)
      wrapButton.onclick = () => {
        prefs.set(wrapKey, wrapped() ? "off" : "on");
        render(style);
      };
    render(prefs.get(key) || automatic());
    new ResizeObserver(() => {
      if (prefs.get(key)) return;
      const next = automatic();
      if (next !== style) render(next);
    }).observe(root);
  },
});
