import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";

const FEEDS = [
  ["BBC News", "https://feeds.bbci.co.uk/news/rss.xml"],
  ["NPR", "https://feeds.npr.org/1001/rss.xml"],
  ["The Guardian", "https://www.theguardian.com/world/rss"],
];

const STOPWORDS = new Set("a an and are as at be been but by can could for from had has have he her hers him his i if in into is it its just may might more most my of on or our out over said she should so some than that the their them then there these they this to too under up us was we were what when where which who will with would you your after before about against between during each few further how other same such through until while why upon also because".split(" "));
const tokenRe = /[a-zA-Z][a-zA-Z0-9']{2,}/g;

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  return createClient(url, key, { auth: { persistSession: false } });
}

function decode(value = "") {
  return value.replace(/<![CDATA[([\s\S]*?)]]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
}

function clean(value = "") {
  return decode(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function tag(block, names) {
  for (const name of names) {
    const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
    if (m?.[1]) return clean(m[1]);
  }
  return "";
}

function canonicalUrl(raw = "") {
  try {
    const u = new URL(raw.trim());
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    u.search = ""; u.hash = "";
    u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  } catch { return ""; }
}

function parseDate(raw = "") {
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "NewsPulse/1.0 (+assessment demo)" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function parseFeed(source, feedUrl) {
  const xml = await fetchText(feedUrl, 7000);
  const blocks = [...xml.matchAll(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi)].map((m) => m[0]);
  return blocks.slice(0, 10).map((block) => {
    const title = tag(block, ["title"]);
    const link = canonicalUrl(tag(block, ["link"])) ||
      canonicalUrl(block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || "");
    const summary = tag(block, ["description", "content:encoded", "summary", "content"]);
    const published = tag(block, ["pubDate", "published", "updated", "created"]);
    if (!title || !link) return null;
    const dedupeKey = crypto.createHash("sha256").update(link).digest("hex");
    return { id: dedupeKey.slice(0, 24), dedupe_key: dedupeKey, title, summary,
      body_text: "", source, url: link, published_at: parseDate(published) };
  }).filter(Boolean);
}

async function extractBody(url) {
  try {
    const html = await fetchText(url, 5500);
    const article = html.match(/<article[\s\S]*?<\/article>/i)?.[0] || "";
    const paragraphs = [...html.matchAll(/<p\b[\s\S]*?<\/p>/gi)]
      .map((m) => clean(m[0])).filter((x) => x.split(/\s+/).length >= 8);
    const articleText = clean(article);
    if (articleText.split(/\s+/).length > 40) return articleText.slice(0, 16000);
    const joined = paragraphs.join(" ");
    if (joined.split(/\s+/).length > 40) return joined.slice(0, 16000);
    return clean(html).slice(0, 16000);
  } catch { return ""; }
}

function tokens(text = "") {
  return (text.match(tokenRe) || []).map((x) => x.toLowerCase())
    .filter((x) => !STOPWORDS.has(x) && !/^\d+$/.test(x));
}

function cosine(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0, na = 0, nb = 0;
  for (const key of keys) {
    const av = a[key] || 0, bv = b[key] || 0;
    dot += av * bv; na += av * av; nb += bv * bv;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function buildClusters(items) {
  const sorted = [...items].sort((a, b) => new Date(a.published_at) - new Date(b.published_at));
  if (!sorted.length) return [];
  const docs = sorted.map((item) => tokens(`${item.title} ${item.summary} ${item.body_text.slice(0, 3500)}`));
  const df = new Map();
  for (const doc of docs) for (const term of new Set(doc)) df.set(term, (df.get(term) || 0) + 1);
  const vectors = docs.map((doc) => {
    const counts = new Map();
    for (const term of doc) counts.set(term, (counts.get(term) || 0) + 1);
    const vector = {}, total = Math.max(1, doc.length);
    for (const [term, count] of counts) vector[term] = (count / total) * (1 + Math.log((sorted.length + 1) / ((df.get(term) || 0) + 1)));
    return vector;
  });

  const groups = [], assigned = new Set(), threshold = 0.27;
  for (let i = 0; i < sorted.length; i++) {
    if (assigned.has(i)) continue;
    const group = [i]; assigned.add(i);
    let changed = true;
    while (changed) {
      changed = false;
      const terms = new Set(group.flatMap((idx) => docs[idx]));
      for (let j = 0; j < sorted.length; j++) {
        if (assigned.has(j)) continue;
        const similarity = Math.max(...group.map((idx) => cosine(vectors[j], vectors[idx])));
        const shared = docs[j].filter((term) => terms.has(term)).length;
        if (similarity >= threshold || shared >= 2) { group.push(j); assigned.add(j); changed = true; }
      }
    }
    groups.push(group);
  }

  return groups.map((members) => {
    const signature = members.map((idx) => sorted[idx].dedupe_key).sort().join("|");
    const common = new Map();
    for (const idx of members) for (const term of new Set(docs[idx])) common.set(term, (common.get(term) || 0) + 1);
    const words = [...common.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([x]) => x);
    return {
      id: "c_" + crypto.createHash("sha1").update(signature).digest("hex").slice(0, 16),
      label: words.length ? words.map((x) => x[0].toUpperCase() + x.slice(1)).join(" · ") : "Untitled topic",
      article_count: members.length,
      start_time: new Date(Math.min(...members.map((idx) => new Date(sorted[idx].published_at).getTime()))).toISOString(),
      end_time: new Date(Math.max(...members.map((idx) => new Date(sorted[idx].published_at).getTime()))).toISOString(),
      members: members.map((idx) => sorted[idx]),
    };
  });
}

async function runLiveIngestion(jobId) {
  const supabase = getSupabase();
  const feedResults = await Promise.allSettled(FEEDS.map(([source, url]) => parseFeed(source, url)));
  const incoming = new Map();
  for (const result of feedResults) {
    if (result.status !== "fulfilled") continue;
    for (const article of result.value) incoming.set(article.dedupe_key, article);
  }

  const { data: existingRows, error: existingError } = await supabase.from("articles").select("dedupe_key").limit(2000);
  if (existingError) throw existingError;
  const existing = new Set((existingRows || []).map((row) => row.dedupe_key));
  const newArticles = [...incoming.values()].filter((article) => !existing.has(article.dedupe_key));

  await Promise.all(newArticles.map(async (article) => { article.body_text = await extractBody(article.url); }));

  for (const article of newArticles) {
    const { error } = await supabase.from("articles").insert(article);
    if (error && error.code !== "23505") throw error;
  }

  const { data: allArticles, error: allError } = await supabase.from("articles")
    .select("id,dedupe_key,title,summary,body_text,source,url,published_at")
    .order("published_at", { ascending: true }).limit(2000);
  if (allError) throw allError;

  const clusters = buildClusters(allArticles || []);
  const clearArticles = await supabase.from("articles").update({ cluster_id: null }).not("cluster_id", "is", null);
  if (clearArticles.error) throw clearArticles.error;
  const clearClusters = await supabase.from("clusters").delete().neq("id", "");
  if (clearClusters.error) throw clearClusters.error;

  for (const cluster of clusters) {
    const { error } = await supabase.from("clusters").insert({
      id: cluster.id, label: cluster.label, article_count: cluster.article_count,
      start_time: cluster.start_time, end_time: cluster.end_time,
    });
    if (error) throw error;
    for (const article of cluster.members) {
      const { error: articleError } = await supabase.from("articles").update({ cluster_id: cluster.id }).eq("id", article.id);
      if (articleError) throw articleError;
    }
  }

  const { error: jobError } = await supabase.from("ingestion_jobs").update({
    status: "completed", finished_at: new Date().toISOString(),
    processed_count: newArticles.length, error: null,
  }).eq("id", jobId);
  if (jobError) throw jobError;

  return { processed: newArticles.length, clusters: clusters.length, total_articles: (allArticles || []).length };
}

async function markFailed(jobId, error) {
  await getSupabase().from("ingestion_jobs").update({
    status: "failed", finished_at: new Date().toISOString(),
    error: String(error?.message || error),
  }).eq("id", jobId);
}

export async function listClusters() {
  const { data, error } = await getSupabase().from("clusters")
    .select("id,label,article_count,start_time,end_time").order("start_time", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getCluster(id) {
  if (!id) return null;
  const supabase = getSupabase();
  const clusterResult = await supabase.from("clusters")
    .select("id,label,article_count,start_time,end_time").eq("id", id).maybeSingle();
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
    .select("id,cluster_id,title,source,published_at,url,summary").in("cluster_id", ids);
  if (error) throw error;

  const byCluster = new Map();
  for (const article of data || []) {
    const list = byCluster.get(article.cluster_id) || [];
    list.push(article); byCluster.set(article.cluster_id, list);
  }

  return {
    clusters: clusters.map((cluster) => {
      const articles = (byCluster.get(cluster.id) || []).sort((a, b) => new Date(a.published_at) - new Date(b.published_at));
      return { ...cluster, size: Math.max(1, cluster.article_count),
        intensity: Math.log2(cluster.article_count + 1),
        sources: [...new Set(articles.map((article) => article.source))], articles };
    }),
    meta: { mode: "live" },
  };
}

export async function triggerIngestion() {
  const supabase = getSupabase();
  const running = await supabase.from("ingestion_jobs").select("id")
    .eq("status", "running").order("started_at", { ascending: false })
    .limit(1).maybeSingle();
  if (running.error) throw running.error;
  if (running.data) return { conflict: true, job_id: running.data.id };

  const jobId = crypto.randomUUID();
  const { error } = await supabase.from("ingestion_jobs").insert({
    id: jobId, status: "running", started_at: new Date().toISOString()
  });
  if (error) throw error;

  waitUntil((async () => {
    try {
      await runLiveIngestion(jobId);
    } catch (error) {
      await markFailed(jobId, error);
    }
  })());

  return { conflict: false, job_id: jobId, status: "running" };
}

export async function getIngestionStatus(jobId) {
  if (!jobId) return null;
  const { data, error } = await getSupabase().from("ingestion_jobs")
    .select("id,status,started_at,finished_at,processed_count,error").eq("id", jobId).maybeSingle();
  if (error) throw error;
  return data || null;
}
