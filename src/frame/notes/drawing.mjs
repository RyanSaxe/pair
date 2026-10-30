import { persist, save, state } from "#frame/app/store.mjs";
import { $, controlKey, uuid } from "#frame/app/util.mjs";
import {
  base,
  feedbackEditable,
  online,
  page,
  plan,
} from "#frame/app/view.mjs";
import { canComment, commentOn, partName } from "#frame/notes/blocks.mjs";
import { addNoteImage } from "#frame/notes/note-dialog.mjs";

let activeDrawing = null;
let draftTimer = null;
function drawingError(message) {
  $("drawing-error").textContent = message;
  $("drawing-error").hidden = !message;
  $("drawing-save").disabled = false;
}
function resetDrawing() {
  if (activeDrawing?.loadingTimer) clearTimeout(activeDrawing.loadingTimer);
  activeDrawing = null;
  $("drawing-frame").removeAttribute("srcdoc");
  if (draftTimer) {
    clearTimeout(draftTimer);
    draftTimer = null;
    persist();
  }
}
function closeDrawing() {
  resetDrawing();
  if ($("drawing-dialog").open) $("drawing-dialog").close();
}
const theme = () => document.documentElement.dataset.theme || "light";
async function savedScene(id) {
  const response = await fetch(
    `${base}/api/drawing-scene/${encodeURIComponent(id)}`,
  );
  if (!response.ok) throw new Error("Could not load the saved drawing.");
  return response.json();
}
/* source is a diagram's Mermaid source, which the editor converts into a
   drawing when scene is null. The frame keeps an unsaved drawing in
   state.drafts under key. */
function openEditor({
  key,
  title,
  detail,
  saveLabel,
  scene,
  source,
  fit = false,
  onSaved,
}) {
  const nonce = uuid();
  activeDrawing = { key, nonce, scene, source, fit, onSaved };
  activeDrawing.loadingTimer = setTimeout(() => {
    if (activeDrawing?.nonce === nonce)
      drawingError(
        "The drawing editor did not load. Check your connection and try again.",
      );
  }, 20000);
  $("drawing-title").textContent = title;
  $("drawing-detail").textContent = detail || "";
  $("drawing-detail").hidden = !detail;
  $("drawing-save").textContent = saveLabel;
  drawingError("");
  $("drawing-save").disabled = true;
  $("drawing-frame").srcdoc = JSON.parse($("drawing-editor-source").textContent)
    .replace("__DRAWING_NONCE__", JSON.stringify(nonce))
    .replace("__DRAWING_THEME__", JSON.stringify(theme()));
  $("drawing-dialog").showModal();
}
export async function openDrawing(id, label, target, onSaved) {
  if (!feedbackEditable() || !online) return;
  const key = controlKey(page.id, id);
  const topic = page.id;
  const previous = state.answers[key];
  let scene = state.drafts[key] ?? null;
  if (!scene && previous?.kind === "drawing")
    scene = await savedScene(previous.sceneId);
  const card = target && document.getElementById(target);
  const question = card?.querySelector(":scope > h3")?.textContent.trim();
  const reason = card?.querySelector(":scope > h3 + p")?.textContent.trim();
  openEditor({
    key,
    title: question || label,
    detail: reason,
    saveLabel: "Save drawing",
    scene,
    onSaved(saved, preview) {
      const answer = {
        topic,
        label,
        kind: "drawing",
        round: plan.round,
        sceneId: saved.id,
        previewId: preview.id,
        target,
      };
      state.answers[key] = answer;
      save();
      onSaved(answer);
    },
  });
}
/* Saving a sketch opens a note on the diagram with the sketch's PNG
   attached. sketchImage adds the scene's ID and path to the PNG's record,
   so editSketch can open the sketch again from the note. */
export const canSketch = () => canComment() && online;
const sketchImage = (saved, preview) => ({
  ...preview,
  scene: { id: saved.id, path: saved.path },
});
export function openSketch(diagram) {
  if (!canSketch()) return;
  const key = `sketch:${controlKey(page.id, diagram.id)}`;
  const id = diagram.id;
  openEditor({
    key,
    title: partName(diagram),
    detail: "Saving attaches the sketch to a note on this diagram.",
    saveLabel: "Save sketch",
    scene: state.drafts[key] ?? null,
    source: diagram.dataset.source,
    fit: true,
    onSaved(saved, preview) {
      persist();
      commentOn(document.getElementById(id) || diagram, {});
      if ($("note-dialog").open) addNoteImage(sketchImage(saved, preview));
    },
  });
}
export async function editSketch(image, onSaved) {
  if (!online) return;
  const key = `sketch:${image.scene.id}`;
  openEditor({
    key,
    title: "Edit sketch",
    saveLabel: "Save sketch",
    scene: state.drafts[key] ?? (await savedScene(image.scene.id)),
    fit: true,
    onSaved(saved, preview) {
      persist();
      onSaved(sketchImage(saved, preview));
    },
  });
}
export function installDrawing() {
  $("drawing-dialog").addEventListener("close", resetDrawing);
  addEventListener("plan:theme", () => {
    if (activeDrawing)
      $("drawing-frame").contentWindow?.postMessage(
        { type: "theme", nonce: activeDrawing.nonce, theme: theme() },
        "*",
      );
  });
  $("drawing-save").onclick = () => {
    if (!activeDrawing) return;
    $("drawing-save").disabled = true;
    $("drawing-frame").contentWindow.postMessage(
      { type: "save", nonce: activeDrawing.nonce },
      "*",
    );
  };
  addEventListener("message", async (event) => {
    const drawing = activeDrawing;
    if (
      !drawing ||
      event.source !== $("drawing-frame").contentWindow ||
      event.data?.nonce !== drawing.nonce
    )
      return;
    if (event.data.type === "ready") {
      clearTimeout(drawing.loadingTimer);
      drawing.loadingTimer = null;
      $("drawing-save").disabled = false;
      event.source.postMessage(
        {
          type: "init",
          nonce: drawing.nonce,
          scene: drawing.scene,
          source: drawing.source,
          fit: drawing.fit,
        },
        "*",
      );
    } else if (event.data.type === "change") {
      /* The frame keeps an unsaved drawing in state.drafts, so closing the
         editor without saving keeps it. An empty drawing removes the draft,
         so the editor next opens on the saved drawing. persist() runs 300ms
         after the last change, or in resetDrawing if the editor closes
         first. */
      const { scene } = event.data;
      if (scene.elements.length) state.drafts[drawing.key] = scene;
      else delete state.drafts[drawing.key];
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => {
        draftTimer = null;
        persist();
      }, 300);
    } else if (event.data.type === "error") {
      drawingError(event.data.message || "Could not save the drawing.");
    } else if (event.data.type === "saved") {
      try {
        const [sceneResponse, previewResponse] = await Promise.all([
          fetch(`${base}/api/drawing-scene`, {
            method: "POST",
            body: JSON.stringify(event.data.scene),
          }),
          fetch(`${base}/api/upload`, { method: "POST", body: event.data.png }),
        ]);
        if (!sceneResponse.ok || !previewResponse.ok)
          throw new Error("Could not upload the drawing. Please try again.");
        const [scene, preview] = await Promise.all([
          sceneResponse.json(),
          previewResponse.json(),
        ]);
        if (activeDrawing !== drawing) return;
        delete state.drafts[drawing.key];
        closeDrawing();
        drawing.onSaved(scene, preview);
      } catch (error) {
        drawingError(error.message || "Could not save the drawing.");
      }
    }
  });
}
