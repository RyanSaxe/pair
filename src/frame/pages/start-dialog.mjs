import { $, copyText, unreachable } from "#frame/app/util.mjs";
import { base } from "#frame/app/view.mjs";
import { sendKey, sendKeyName } from "#frame/notes/threads.mjs";
import { remote } from "#frame/sync/rounds.mjs";

/* Start on a recorded side-work item opens this popup. Copy prompt puts a
   prompt for a new agent session on the clipboard, and Start in parallel
   wakes this session's agent with the reviewer's optional message. */

// Each item's unsent message, kept until the tab reloads.
const drafts = new Map();
let current = null;

// The new session's agent plans the item in a pair session of its own, then
// moves the item there, which folds it into Finished on this Agreed.
export function startPrompt(item, sessionDir, message) {
  return [
    "Plan this side work in a new pair session. Run pair guide and follow what it prints.",
    `Side work ${item.id} from the pair session in ${sessionDir}:\n${item.title}\n${item.text}\nSource: ${item.source}`,
    ...(message ? [`My note: ${message}`] : []),
    `Once your pair session has started, close the item in that session with pair side-work update ${item.id} --state moved --url NEW_SESSION_URL --session-dir ${sessionDir}, where NEW_SESSION_URL is the url that pair start printed.`,
  ].join("\n\n");
}
function startError(text) {
  $("start-error").hidden = !text;
  $("start-error").textContent = text;
}
// started(result) runs with the hub's answer once it accepts the start.
async function startInParallel(item, started) {
  const message = $("start-message").value.trim();
  const button = $("start-send");
  startError("");
  button.disabled = true;
  try {
    const response = await fetch(
      `${base}/api/side-work/${encodeURIComponent(item.id)}/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message ? { message } : {}),
      },
    );
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "The hub refused.");
    drafts.delete(item.id);
    $("start-dialog").close();
    started(result);
  } catch (error) {
    startError(unreachable(error));
  } finally {
    button.disabled = false;
    // Disabling the button moved focus out of the popup.
    if ($("start-dialog").open) button.focus();
  }
}
// The label reads Copied for 1.5 seconds, as the frame's Copy buttons do,
// and the popup stays open.
async function copyPrompt(item) {
  const text = startPrompt(
    item,
    remote.sessionDir,
    $("start-message").value.trim(),
  );
  const label = $("start-copy-label");
  label.textContent = (await copyText(text)) ? "Copied" : "Copy failed";
  setTimeout(() => (label.textContent = "Copy prompt"), 1500);
}
export function openStart(item, started) {
  current = item;
  $("start-item").textContent = item.title;
  $("start-message").value = drafts.get(item.id) ?? item.message ?? "";
  $("start-message").oninput = (event) =>
    drafts.set(current.id, event.target.value);
  // The keys follow the buttons' places in the note dialog: ⌘ Enter (Ctrl
  // Enter off Apple) copies, as it starts a thread from a note, and Shift
  // Enter starts in parallel, as it adds a note to feedback. Enter adds a
  // line.
  $("start-message").onkeydown = (event) => {
    const start =
      event.key === "Enter" &&
      event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey;
    if (!start && !sendKey(event)) return;
    event.preventDefault();
    $(start ? "start-send" : "start-copy").click();
  };
  $("start-copy").onclick = () => copyPrompt(item);
  $("start-send").onclick = () => startInParallel(item, started);
  $("start-copy").setAttribute("aria-keyshortcuts", sendKeyName());
  startError("");
  $("start-dialog").showModal();
  $("start-message").focus();
}
