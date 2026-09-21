const EDGE_FUNCTION = "https://smpmvabjafmrutdhbfbl.supabase.co/functions/v1/news-pulse";
const DEMO_TOKEN = "news-pulse-demo-2026";

async function call(path, options = {}) {
  const response = await fetch(EDGE_FUNCTION + path, {
    ...options,
    headers: {
      "x-news-pulse-token": DEMO_TOKEN,
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error || `Backend request failed (${response.status})`);
    error.status = response.status;
    error.job_id = body?.job_id || null;
    throw error;
  }
  return body;
}

export async function listClusters() {
  return (await call("/clusters")).clusters || [];
}

export async function getCluster(id) {
  try {
    return (await call(`/clusters/${encodeURIComponent(id)}`)).cluster || null;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

export async function getTimeline() {
  return call("/timeline");
}

export async function triggerIngestion() {
  try {
    return { ...(await call("/ingest/trigger", { method: "POST", body: "{}" })), conflict: false };
  } catch (error) {
    if (error.status === 409) return { conflict: true, job_id: error.job_id, status: "running" };
    throw error;
  }
}

export async function getIngestionStatus(jobId) {
  try {
    return await call(`/ingest/status?id=${encodeURIComponent(jobId)}`);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}
