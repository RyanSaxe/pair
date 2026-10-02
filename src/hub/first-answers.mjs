import { jsonScriptTag } from "../shared/util.mjs";

/* A page load draws its first frame before the frame's first polls return,
   so a session the reviewer switches to would paint without its badges,
   bell, page list and round card, and fill them in a moment later. The hub
   writes its answers to those first requests into the page it serves, and a
   script ahead of the frame answers each of them once from the page. The
   frame's first poll then completes before the first paint. The frame is
   unchanged, so this also holds for rounds built by an earlier pair. */
export async function firstAnswers(session, sessions) {
  const base = session.base;
  const status = session.browserView();
  const answers = {
    [`${base}/api/status`]: status,
    "/api/sessions": { sessions },
  };
  // Current's round, and the round the left tab opens on.
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
      // A round without a page set is fetched as before.
    }
  }
  try {
    answers[`${base}/api/submission`] = {
      submission: await session.latestFeedback(null),
    };
  } catch {
    // Fetched as before.
  }
  return answers;
}

// Each answer is used once, by a GET for the same path, so every later poll
// reaches the hub. The script is a module in the head, so it runs before the
// frame's modules, which follow it in the body.
const answerScript = `<script type="module">
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

// The answers and the script that serves them, for the page's head.
export function firstAnswersHead(answers) {
  return jsonScriptTag("first-answers", answers) + answerScript;
}
