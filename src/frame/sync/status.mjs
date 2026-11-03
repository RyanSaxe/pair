import { base } from "#frame/app/view.mjs";

/* The frame polls the status and the session list, and most polls find nothing
   changed. fetchPolled sends back the tag of the last answer, and a 304 then
   costs only headers, so the poll reads the text it kept. Playwright's WebKit
   doesn't revalidate a cached answer on its own, so the frame sends the tag
   itself. The page answers the first poll with no tag. */
const answers = new Map();
export async function fetchPolled(url, init = {}) {
  const kept = answers.get(url);
  const response = await fetch(url, {
    ...init,
    ...(kept ? { headers: { "If-None-Match": kept.tag } } : {}),
  });
  if (response.status === 304) return JSON.parse(kept.text);
  if (!response.ok) throw Error();
  const tag = response.headers?.get("ETag");
  if (!tag) return response.json();
  const text = await response.text();
  answers.set(url, { tag, text });
  return JSON.parse(text);
}
/* A status can take longer than a poll's interval to arrive on a phone's
   connection. A browser opens only six connections to the hub, so polls that
   overlap fill them and hold back every other request. poll() therefore skips
   while a status is on its way, and a request that stalls ends at
   STATUS_LIMIT_MS so that the next poll can run. */
const STATUS_LIMIT_MS = 30000;
export let statusLoading = false;
export async function fetchStatus() {
  statusLoading = true;
  try {
    return await fetchPolled(`${base}/api/status`, {
      signal: AbortSignal.timeout(STATUS_LIMIT_MS),
    });
  } finally {
    statusLoading = false;
  }
}
