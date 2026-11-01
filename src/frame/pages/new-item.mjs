import { persist, state } from "#frame/app/store.mjs";
import { $, fitText } from "#frame/app/util.mjs";
import {
  acceptImages,
  forgetImages,
  imageFigure,
  uploadImages,
} from "#frame/notes/images.mjs";

/* The Start dialog's New work item form uses the note dialog's field. The
   frame keeps the form's text and images in state.itemDraft until the card
   exists, as it keeps a reply's draft, so closing the dialog or reloading
   the page loses nothing. */

// The frame chooses a new card's ID before it posts, because Copy command
// must copy the command during the click. The hub refuses an ID that is not
// a slug or that the session already has.
export function itemId(title, taken) {
  const slug =
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 50)
      .replace(/^-+|-+$/g, "") || "item";
  let id = slug;
  for (let suffix = 2; taken.includes(id); suffix++) id = `${slug}-${suffix}`;
  return id;
}

const draft = () => state.itemDraft ?? { title: "", text: "", attachments: [] };
function keep(change) {
  state.itemDraft = { ...draft(), ...change };
  persist();
}
export function clearItem() {
  state.itemDraft = null;
  persist();
}
let uploading = 0;
function drawUploading() {
  const busy = uploading > 0;
  $("start-write-uploading").hidden = !busy;
  for (const button of $("start-dialog").querySelectorAll(
    ".start-actions .btn",
  ))
    button.disabled = busy;
}
function drawImages() {
  const { attachments } = draft();
  const strip = $("start-write-strip");
  strip.hidden = !attachments.length;
  strip.replaceChildren(
    ...attachments.map((item) =>
      imageFigure(item, () => {
        keep({
          attachments: draft().attachments.filter(
            (held) => held.id !== item.id,
          ),
        });
        forgetImages([item]);
        drawImages();
      }),
    ),
  );
}
function imageError(message) {
  const line = $("start-write-error");
  line.textContent = message;
  line.hidden = !message;
}
// The dialog keeps its buttons disabled during an upload, so a card cannot
// lose an image that is still on its way to the hub.
async function attach(files) {
  uploading++;
  drawUploading();
  await uploadImages(
    files,
    (record) => {
      keep({ attachments: [...draft().attachments, record] });
      drawImages();
    },
    imageError,
  );
  uploading--;
  drawUploading();
}
export function lockItem(locked) {
  for (const id of [
    "start-write-title",
    "start-write-text",
    "start-write-pick",
  ])
    $(id).disabled = locked;
}
// fitItem measures the text, so the frame calls it once the dialog is open.
export const fitItem = () => fitText($("start-write-text"));
export function drawItem() {
  const { title, text } = draft();
  $("start-write-title").value = title;
  $("start-write-text").value = text;
  lockItem(false);
  imageError("");
  drawImages();
  drawUploading();
}
export function itemFields() {
  const { attachments } = draft();
  return {
    title: $("start-write-title").value.trim(),
    delivers: $("start-write-text").value.trim(),
    attachments,
  };
}
// The browser's required check accepts text that is only spaces, so
// itemReady empties such a field first.
export function itemReady() {
  for (const id of ["start-write-title", "start-write-text"]) {
    const field = $(id);
    if (!field.value.trim()) field.value = "";
    if (!field.reportValidity()) return false;
  }
  return uploading === 0;
}
export function installItem() {
  const title = $("start-write-title");
  const text = $("start-write-text");
  title.oninput = () => keep({ title: title.value });
  text.addEventListener("input", () => {
    keep({ text: text.value });
    fitItem();
  });
  addEventListener("resize", () => {
    if (!$("start-write").hidden && $("start-dialog").open) fitItem();
  });
  $("start-write-pick").append(
    $("note-image-pick").querySelector("svg").cloneNode(true),
  );
  $("start-write-pick").onclick = () => $("start-write-images").click();
  $("start-write-images").onchange = (event) => {
    attach(event.target.files);
    event.target.value = "";
  };
  acceptImages($("start-write"), attach);
}
