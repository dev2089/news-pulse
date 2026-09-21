import { createClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";

const DEFAULT_SUPABASE_URL = "https://smpmvabjafmrutdhbfbl.supabase.co";
const DEFAULT_SUPABASE_KEY = "sb_publishable_E7EU3ofBU4MThptewl5Sbw_e2GrOqjG";

export function getSupabase() {
  const url = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_KEY;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function listClusters() {
  const { data, error } = await getSupabase().from("clusters")
    .select("id,label,article_count,start_time,end_time")
    .order("start_time", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getCluster(id) {
  if (!id) return null;
  const supabase = getSupabase();
  const clusterResult = await supabase.from("clusters")
    .select("id,label,article_count,start_time,end_time")
    .eq("id", id).maybeSingle();
  if (clusterResult.error) throw clusterResult.error;
  if (!clusterResult.data) return null;

  const articleResult = await supabase.from("articles")
    .select("id,title,source,published_at,url,summary,body_text")
    .eq("cluster_id", id).order("published_at", { ascending: true });
  if (articleResult.error) throw articleResult.error;

  return { ...clusterResult.data, articles: articleResult.data || [] };
}

export async function getTimeline() {
  const supabase = getSupabase();
  const clusters = await listClusters();
  if (!clusters.length) return { clusters: [], meta: { mode: "empty" } };

  const ids = clusters.map((cluster) => cluster.id);
  const { data, error } = await supabase.from("articles")
    .select("id,cluster_id,title,source,published_at,url,summary")
    .in("cluster_id", ids);
  if (error) throw error;

  const byCluster = new Map();
  for (const article of data || []) {
    const list = byCluster.get(article.cluster_id) || [];
    list.push(article);
    byCluster.set(article.cluster_id, list);
  }

  return {
    clusters: clusters.map((cluster) => {
      const articles = (byCluster.get(cluster.id) || []).sort(
        (a, b) => new Date(a.published_at) - new Date(b.published_at)
      );
      return {
        ...cluster,
        size: Math.max(1, cluster.article_count),
        intensity: Math.log2(cluster.article_count + 1),
        sources: [...new Set(articles.map((article) => article.source))],
        articles,
      };
    }),
    meta: { mode: "live" },
  };
}

async function markFailed(jobId, error) {
  await getSupabase().from("ingestion_jobs").update({
    status: "failed",
    finished_at: new Date().toISOString(),
    error: String(error?.message || error),
  }).eq("id", jobId);
}

async function runPythonIngestion(baseUrl, jobId) {
  try {
    const headers = {
      "content-type": "application/json",
      "x-news-pulse-job": jobId,
    };
    if (process.env.VERCEL_OIDC_TOKEN) {
      headers["x-vercel-trusted-oidc-idp-token"] = process.env.VERCEL_OIDC_TOKEN;
    }
    const response = await fetch(`${baseUrl}/api/ingest.py`, {
      method: "POST",
      headers,
      body: JSON.stringify({ job_id: jobId }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Python ingestion failed (${response.status})`);
  } catch (error) {
    await markFailed(jobId, error);
  }
}

export async function triggerIngestion(baseUrl) {
  const supabase = getSupabase();
  const running = await supabase.from("ingestion_jobs")
    .select("id").eq("status", "running")
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (running.error) throw running.error;
  if (running.data) return { conflict: true, job_id: running.data.id };

  const jobId = crypto.randomUUID();
  const { error } = await supabase.from("ingestion_jobs").insert({
    id: jobId, status: "running", started_at: new Date().toISOString()
  });
  if (error) throw error;

  waitUntil(runPythonIngestion(baseUrl, jobId));
  return { conflict: false, job_id: jobId, status: "running" };
}

export async function getIngestionStatus(jobId) {
  if (!jobId) return null;
  const { data, error } = await getSupabase().from("ingestion_jobs")
    .select("id,status,started_at,finished_at,processed_count,error")
    .eq("id", jobId).maybeSingle();
  if (error) throw error;
  return data || null;
}
