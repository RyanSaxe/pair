import assert from "node:assert/strict";
import test from "node:test";
import {
  sendAccepts,
  sendState,
} from "../../../src/frame/review/send-state.mjs";

const live = { editable: true, connected: true };

// Each row is a set of the fields the frame keeps, the state they give and
// the actions that state accepts. A later field in sendState's order counts
// only when every earlier one is false. tests/browser/send.browser.mjs edits
// and sends a round, so the table leaves out the state with every field
// false.
test("sendState works out the Current tab's send from the fields the frame keeps", () => {
  for (const [fields, expected, actions] of [
    [{ editable: false, connected: true }, "read-only", []],
    [{ ...live, closed: true }, "read-only", []],
    [{ ...live, sending: true, sent: true }, "sending", []],
    [{ ...live, sent: true, openRound: true, failed: true }, "waiting", []],
    [{ ...live, connected: false, sent: true }, "waiting", []],
    [{ ...live, connected: false, openRound: true }, "pages-pending", ["edit"]],
    [{ ...live, connected: false, failed: true }, "unreachable", ["edit"]],
    [{ ...live, failed: true }, "failed", ["edit", "send"]],
  ]) {
    const state = sendState(fields);
    assert.equal(state, expected, JSON.stringify(fields));
    assert.deepEqual(
      ["edit", "send"].filter((action) => sendAccepts(action, state)),
      actions,
      state,
    );
  }
});
