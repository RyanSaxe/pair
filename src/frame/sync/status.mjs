import { base } from "#frame/app/view.mjs";

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
    const response = await fetch(`${base}/api/status`, {
      signal: AbortSignal.timeout(STATUS_LIMIT_MS),
    });
    if (!response.ok) throw Error();
    return await response.json();
  } finally {
    statusLoading = false;
  }
}
