/* A Pele diagram, and the dialog that shows its rendered layout full size. */
async function renderDiagram(element) {
  const source = (element.dataset.source ??= element.textContent);
  let mounted;
  const report = (error) => {
    if (!element.isConnected) return;
    mounted?.destroy();
    diagrams.delete(element);
    element.textContent = source;
    failed(element, error);
  };
  try {
    const pele = await planUI.pele();
    if (!element.isConnected) return;
    mounted = pele.mount(element, source, {
      fontSize: 14,
      zoom: false,
      onRender(result) {
        element.style.setProperty("--diagram-width", `${result.width}px`);
        linkNodes(element);
        // Pele draws the SVG again for a new width, without the marks on
        // noted boxes.
        queueMicrotask(() => window.dispatchEvent(new Event("plan:diagram")));
      },
      onError(error) {
        // mount() calls this before returning its handle on an initial error.
        if (mounted) queueMicrotask(() => report(error));
      },
    });
    if (mounted.error) {
      report(mounted.error);
      return;
    }
    diagrams.set(element, mounted);
    element.addEventListener("click", (event) => {
      const id = linkedPage(event);
      if (!id) return;
      event.stopPropagation();
      show(id);
    });
    element.addEventListener("keydown", (event) => {
      const id = linkedPage(event);
      if (!id || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      show(id);
    });
  } catch (error) {
    report(error);
  }
}
function linkNodes(element) {
  let linked = false;
  for (const node of element.querySelectorAll(".pele-node[data-id]")) {
    if (node.querySelector("a") || node.closest("a")) continue;
    const destination = pages.find((item) => item.id === node.dataset.id);
    if (!destination) continue;
    linked = true;
    node.classList.add("linked");
    node.setAttribute("role", "link");
    node.setAttribute("tabindex", "0");
    node.setAttribute("aria-label", `Open ${destination.title}`);
  }
  if (linked) element.querySelector("svg")?.setAttribute("role", "group");
}
function linkedPage(event) {
  if (event.target.closest("a")) return null;
  return event.target.closest(".pele-node.linked")?.dataset.id;
}
/* Links use their own activation; the rest of the diagram opens full size.
   A drag across a label selects it for a note, so only a click with
   nothing selected opens the full-size copy. */
$("page-content").addEventListener("click", (event) => {
  const svg = event.target.closest("[data-diagram] svg");
  if (!svg || event.target.closest("a, .pele-node.linked")) return;
  if (getSelection()?.toString().trim()) return;
  openLightbox(svg);
});
/* Page and component styles are scoped to #page-content, so the dialog moves
   there while open. Keep its reference across page-content replacements. */
const lightbox = $("diagram-dialog");
const lightboxHome = lightbox.parentElement;
function returnLightboxHome() {
  lightboxHome.append(lightbox);
}
lightbox.addEventListener("close", () => {
  if (!lightbox.open) returnLightboxHome();
});
/* Repeat ancestor classes and inline variables so authored selectors and
   before-and-after styles also match the enlarged copy. */
function withAncestors(svg, clone) {
  let copy = clone;
  const root = $("page-content");
  for (let node = svg.parentElement; node && node !== root;) {
    const box = document.createElement("div");
    box.className = node.className;
    box.style.cssText = node.style.cssText;
    box.style.display = "contents";
    box.append(copy);
    copy = box;
    node = node.parentElement;
  }
  return copy;
}
// The original and enlarged SVG coexist, so fragment and ARIA IDs must differ.
function copySvg(svg) {
  const clone = svg.cloneNode(true);
  const prefix = "enlarged-" + uuid() + "-";
  const ids = new Map();
  for (const node of [clone, ...clone.querySelectorAll("[id]")]) {
    if (!node.id) continue;
    ids.set(node.id, prefix + node.id);
    node.id = prefix + node.id;
  }
  for (const node of [clone, ...clone.querySelectorAll("*")]) {
    for (const attribute of [...node.attributes]) {
      let value = attribute.value.replace(
        /url\(["']?#([^)"']+)["']?\)/g,
        (match, id) => (ids.has(id) ? `url(#${ids.get(id)})` : match),
      );
      if (
        ["href", "xlink:href"].includes(attribute.name) &&
        value.startsWith("#")
      )
        value = "#" + (ids.get(value.slice(1)) ?? value.slice(1));
      if (["aria-labelledby", "aria-describedby"].includes(attribute.name))
        value = value
          .split(/\s+/)
          .map((id) => ids.get(id) ?? id)
          .join(" ");
      if (value !== attribute.value) node.setAttribute(attribute.name, value);
    }
  }
  return clone;
}
function openLightbox(svg) {
  const dialog = lightbox;
  const diagram = svg.closest("[data-diagram]");
  // A click on a box opens a note on it while a note can open.
  const noting = canComment() && !diagram.closest("pair-thread");
  dialog.classList.toggle("noting", noting);
  // Sketch on this diagram opens an editable copy of it in the drawing
  // editor, while the frame can keep a sketch.
  const sketch = $("diagram-sketch");
  sketch.hidden = !noting || !canSketch();
  sketch.onclick = () => {
    close();
    openSketch(diagram);
  };
  const close = () => {
    returnLightboxHome();
    dialog.close();
  };
  dialog.style.setProperty(
    "--diagram-width",
    diagram.style.getPropertyValue("--diagram-width"),
  );
  const clone = copySvg(svg);
  dialog
    .querySelector(".lightbox-view")
    .replaceChildren(withAncestors(svg, clone));
  // The frame's note handlers must not treat a dialog click as a page note.
  dialog.onmousemove = (event) => event.stopPropagation();
  dialog.onclick = (event) => {
    event.stopPropagation();
    if (event.target.closest("[data-close]")) return close();
    const id = linkedPage(event);
    if (id) {
      close();
      show(id);
      return;
    }
    const box = !event.target.closest("a") && diagramBox(event.target);
    if (!box || !noting) return;
    close();
    commentOn(diagram, { quote: box.label, diagramNode: box.id });
  };
  dialog.onkeydown = (event) => {
    const id = linkedPage(event);
    if (!id || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    close();
    show(id);
  };
  $("page-content").append(dialog);
  if (dialog.open) dialog.close();
  dialog.showModal();
}
planUI.define("diagram", {
  match: "[data-diagram]",
  setup(element) {
    /* A note on one box names its diagram by ID. A diagram that is a block
       has the block's ID, and one inside a block takes its place among the
       page's diagrams. A diagram in a thread's reply takes no note. */
    if (!element.id && !element.closest("pair-thread")) {
      const index = [...$("page-content").querySelectorAll("[data-diagram]")]
        .filter((item) => !item.closest("pair-thread"))
        .indexOf(element);
      if (index >= 0) element.id = `pair-diagram-${page.id}-${index}`;
    }
    if (element.dataset.caption)
      figure(element, { caption: element.dataset.caption, kind: "diagram" });
    return renderDiagram(element);
  },
});
