import { jsonScriptTag } from "../shared/util.mjs";

/* The browser paints a page before the frame's first polls return, so a
   session the reviewer switches to would paint without its badges, bell,
   page list and round card, and fill them in a moment later. The hub writes
   its responses to those first requests into the page it serves, and
   answerScript resolves each of those requests once from the page, so the
   frame's first poll completes before the first paint. The frame's code does
   not change, so this also works for rounds built by an earlier pair. */
export async function firstAnswers(session, sessionList) {
  const base = session.base;
  const status = session.browserView();
  const answers = {
    [`${base}/api/status`]: status,
    "/api/sessions": sessionList,
  };
  // The frame first requests the current round and latestSubmissionRound,
  // the round its left tab opens on.
  const rounds = new Set(
    [status.current?.round, status.latestSubmissionRound].filter(Boolean),
  );
  for (const round of rounds) {
    try {
      const manifest = session.pageSet(round);
      const agreed = manifest.pages.find((slot) => slot.id === "agreed");
      const record = await session.pageRecord(round, "agreed", agreed.version);
      answers[`${base}/api/page-set?round=${encodeURIComponent(round)}`] =
        manifest;
      answers[
        `${base}/api/page?round=${encodeURIComponent(round)}&id=agreed&version=${agreed.version}`
      ] = record;
    } catch {
      // The frame fetches a round without a page set from the hub.
    }
  }
  try {
    answers[`${base}/api/submission`] = {
      submission: await session.latestFeedback(null),
    };
  } catch {
    // The frame fetches the submission from the hub.
  }
  return answers;
}

// answerScript serves each stored response once, to a GET for the same path,
// so every later poll reaches the hub. It is a classic script, so the browser
// runs it as it parses the head, before any module script runs.
const answerScript = `<script>
(() => {
  const answers = new Map(
    Object.entries(
      JSON.parse(document.getElementById("first-answers").textContent),
    ),
  );
  const network = window.fetch.bind(window);
  window.fetch = (resource, init) => {
    const url = typeof resource === "string" && new URL(resource, location.href);
    const key = url && url.origin === location.origin && url.pathname + url.search;
    if (init?.method || !answers.has(key)) return network(resource, init);
    const value = answers.get(key);
    answers.delete(key);
    return Promise.resolve({ ok: true, status: 200, json: async () => value });
  };
})();
</script>`;

export function firstAnswersHead(answers) {
  return jsonScriptTag("first-answers", answers) + answerScript;
}
