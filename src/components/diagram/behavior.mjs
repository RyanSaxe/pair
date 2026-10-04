/* A Mermaid diagram, and the dialog that shows it full size. */
let mermaidTask;
let diagramSequence = Promise.resolve();
/* Mermaid keeps one global configuration and one id counter, so diagrams
   render one after another on a single chain rather than in parallel. */
function renderDiagram(element) {
  element.dataset.source ||= element.textContent;
  diagramSequence = diagramSequence
    .catch(() => {})
    .then(async () => {
      /* Mermaid renders into a container of its own named after the render
         id. It removes that container when the render succeeds and leaves it
         attached to the body when the source does not parse, where it draws
         a full-width error graphic outside the app. */
      const id = "diagram-" + uuid();
      let container;
      try {
        if (!element.isConnected) return;
        mermaidTask ||= (async () => {
          const [{ default: mermaid }, elk] = await Promise.all([
            import(libraries.mermaid),
            import(libraries.elk),
          ]);
          mermaid.registerLayoutLoaders(elk.default ?? elk);
          return mermaid;
        })();
        const mermaid = await mermaidTask;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            primaryColor: color("--panel"),
            primaryTextColor: color("--ink"),
            primaryBorderColor: color("--line-strong"),
            lineColor: color("--muted"),
            secondaryColor: color("--panel"),
            tertiaryColor: color("--ground"),
            clusterBkg: "transparent",
            clusterBorder: color("--line"),
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
          },
          // ELK cannot lay out a mind map, so a mind map keeps Mermaid's own
          // layout.
          layout: /^\s*mindmap\b/.test(element.dataset.source)
            ? undefined
            : "elk",
          flowchart: {
            nodeSpacing: 28,
            rankSpacing: 38,
            titleTopMargin: 8,
            htmlLabels: true,
          },
        });
        /* Without a container, Mermaid draws the diagram full size at the
           end of the body to measure it, which makes the window scroll until
           the render ends. A fixed container keeps it out of the layout. */
        container = document.createElement("div");
        container.setAttribute("aria-hidden", "true");
        container.style.cssText =
          "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none";
        document.body.append(container);
        const result = await mermaid.render(
          id,
          element.dataset.source,
          container,
        );
        if (!element.isConnected) return;
        element.innerHTML = result.svg;
        const width = element.querySelector("svg")?.viewBox?.baseVal?.width;
        if (width) element.style.setProperty("--diagram-width", `${width}px`);
        linkNodes(element);
      } catch (error) {
        failed(element, error);
      } finally {
        document.getElementById("d" + id)?.remove();
        container?.remove();
      }
    });
  return diagramSequence;
}
function linkNodes(element) {
  for (const node of element.querySelectorAll(".node")) {
    const id = node.id.match(/^flowchart-(.+)-\d+$/)?.[1];
    if (!id || !pages.some((item) => item.id === id)) continue;
    node.classList.add("linked");
    node.setAttribute("role", "link");
    node.tabIndex = 0;
    node.setAttribute(
      "aria-label",
      `Open ${pages.find((item) => item.id === id).title}`,
    );
    const open = (event) => {
      event?.stopPropagation();
      show(id);
    };
    node.addEventListener("click", open);
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open(event);
      }
    });
  }
}
function renderDiagrams(root) {
  for (const element of root.querySelectorAll("[data-diagram]"))
    renderDiagram(element);
  return diagramSequence;
}
// Any rendered diagram opens full size; the dialog closes on Escape, on its
// close button or on a click outside, like the other dialogs.
$("page-content").addEventListener("click", (event) => {
  const svg = event.target.closest("[data-diagram] svg");
  if (!svg || event.target.closest("a, .node.linked")) return;
  openLightbox(svg);
});
/* assemble.mjs scopes the component styles and the page's own styles to
   #page-content, so openLightbox() moves the dialog into it, and the close
   handler moves it back. A page render replaces the children of
   #page-content, so the module keeps its own reference to the dialog
   instead of looking it up by id on each open. */
const lightbox = $("diagram-dialog");
const lightboxHome = lightbox.parentElement;
function returnLightboxHome() {
  lightboxHome.append(lightbox);
}
lightbox.addEventListener("close", () => {
  if (!lightbox.open) returnLightboxHome();
});
/* withAncestors() wraps the copy in empty boxes that repeat the classes of
   the diagram's ancestors up to #page-content, so a rule such as
   .change-content .node.added still matches the copy. Each box has
   display: contents, so no ancestor's layout rules draw a box. */
function withAncestors(svg, clone) {
  let copy = clone;
  const root = $("page-content");
  for (let node = svg.parentElement; node && node !== root;) {
    const box = document.createElement("div");
    box.className = node.className;
    box.style.display = "contents";
    box.append(copy);
    copy = box;
    node = node.parentElement;
  }
  return copy;
}
function openLightbox(svg) {
  const dialog = lightbox;
  const close = () => {
    returnLightboxHome();
    dialog.close();
  };
  dialog.style.setProperty(
    "--diagram-width",
    svg.closest("[data-diagram]").style.getPropertyValue("--diagram-width"),
  );
  const clone = svg.cloneNode(true);
  for (const node of clone.querySelectorAll(".node.linked")) {
    node.removeAttribute("tabindex");
    node.removeAttribute("role");
  }
  dialog
    .querySelector(".lightbox-view")
    .replaceChildren(withAncestors(svg, clone));
  /* The frame's note and comment handlers on #page-content would treat a
     click or a pointer move in the dialog as one on the page. */
  dialog.onmousemove = (event) => event.stopPropagation();
  dialog.onclick = (event) => {
    event.stopPropagation();
    if (event.target === dialog) return close();
    if (event.target.closest("[data-close]")) return close();
    const id = event.target
      .closest(".node.linked")
      ?.id.match(/^flowchart-(.+)-\d+$/)?.[1];
    if (!id) return;
    close();
    show(id);
  };
  $("page-content").append(dialog);
  if (dialog.open) dialog.close();
  dialog.showModal();
}
/* Mermaid bakes the theme into the SVG it writes, so a theme change
   draws every diagram on the page again. */
window.addEventListener("plan:theme", () =>
  renderDiagrams(document.getElementById("page-content")),
);
planUI.define("diagram", {
  match: "[data-diagram]",
  setup(element) {
    if (element.dataset.caption)
      figure(element, { caption: element.dataset.caption, kind: "diagram" });
    return renderDiagram(element);
  },
});
