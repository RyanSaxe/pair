import { persist, save, state } from "#frame/app/store.mjs";
import { $, controlKey, uuid } from "#frame/app/util.mjs";
import {
  base,
  feedbackEditable,
  online,
  page,
  plan,
} from "#frame/app/view.mjs";

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
export async function openDrawing(id, label, target, onSaved) {
  if (!feedbackEditable() || !online) return;
  const key = controlKey(page.id, id);
  const previous = state.answers[key];
  // A drawing the reviewer left without saving opens as they left it.
  let scene = state.drafts[key] ?? null;
  if (!scene && previous?.kind === "drawing") {
    const response = await fetch(
      `${base}/api/drawing-scene/${encodeURIComponent(previous.sceneId)}`,
    );
    if (!response.ok) throw new Error("Could not load the saved drawing.");
    scene = await response.json();
  }
  const nonce = uuid();
  activeDrawing = { key, label, target, nonce, scene, onSaved, topic: page.id };
  activeDrawing.loadingTimer = setTimeout(() => {
    if (activeDrawing?.nonce === nonce)
      drawingError(
        "The drawing editor did not load. Check your connection and try again.",
      );
  }, 20000);
  // The header shows the card's question and its reason, and the short
  // label when the card has no heading.
  const card = target && document.getElementById(target);
  const question = card?.querySelector(":scope > h3")?.textContent.trim();
  const reason = card?.querySelector(":scope > h3 + p")?.textContent.trim();
  $("drawing-title").textContent = question || label;
  $("drawing-detail").textContent = reason || "";
  $("drawing-detail").hidden = !reason;
  drawingError("");
  $("drawing-save").disabled = true;
  $("drawing-frame").srcdoc = JSON.parse(
    $("drawing-editor-source").textContent,
  ).replace("__DRAWING_NONCE__", JSON.stringify(nonce));
  $("drawing-dialog").showModal();
}
export function installDrawing() {
  $("drawing-dialog").addEventListener("close", resetDrawing);
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
        { type: "init", nonce: drawing.nonce, scene: drawing.scene },
        "*",
      );
    } else if (event.data.type === "change") {
      /* The frame keeps the drawing as a draft until the reviewer saves
         it, so backing out of the editor keeps it. A drawing with no
         element left is no draft, and the editor opens on the saved
         drawing again. The frame writes the draft to localStorage 300ms
         after the last change, or when the editor closes if that is
         sooner. */
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
        const answer = {
          topic: drawing.topic,
          label: drawing.label,
          kind: "drawing",
          round: plan.round,
          sceneId: scene.id,
          previewId: preview.id,
          target: drawing.target,
        };
        state.answers[drawing.key] = answer;
        delete state.drafts[drawing.key];
        save();
        drawing.onSaved(answer);
        closeDrawing();
      } catch (error) {
        drawingError(error.message || "Could not save the drawing.");
      }
    }
  });
}
