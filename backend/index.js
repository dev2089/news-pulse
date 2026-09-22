import { createClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";
import { randomUUID } from "node:crypto";

function getClient(){
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase environment variables are missing");
  return createClient(url, key, { auth: { persistSession:false } });
}

function normalizedParts(pathname){
  const parts = pathname.split("/").filter(Boolean);
  if(parts[0] === "api") parts.shift();
  return parts;
}

async function listClusters(client){
  const { data, error } = await client.from("clusters").select("id,label,article_count,start_time,end_time").order("start_time", { ascending:false });
  if(error) throw error;
  return data || [];
}

async function timeline(client){
  const clusters = await listClusters(client);
  if(!clusters.length) return { clusters:[], meta:{mode:"empty"} };
  const ids = clusters.map(c => c.id);
  const { data, error } = await client.from("articles").select("id,cluster_id,title,source,published_at,url,summary").in("cluster_id", ids);
  if(error) throw error;
  const byCluster = new Map();
  for(const article of data || []){
    const bucket = byCluster.get(article.cluster_id) || [];
    bucket.push(article);
    byCluster.set(article.cluster_id, bucket);
  }
  return {
    clusters: clusters.map(cluster => {
      const articles = (byCluster.get(cluster.id) || []).sort((a,b) => new Date(a.published_at) - new Date(b.published_at));
      return {
        ...cluster,
        size: Math.max(1, Number(cluster.article_count || 0)),
        intensity: Math.log2(Number(cluster.article_count || 0) + 1),
        sources: [...new Set(articles.map(article => article.source))],
        articles
      };
    }),
    meta:{mode:"live"}
  };
}

async function markFailed(client, jobId, error){
  await client.from("ingestion_jobs").update({status:"failed",finished_at:new Date().toISOString(),error:String(error?.message || error)}).eq("id", jobId);
}

async function triggerPython(baseUrl, jobId){
  try{
    const response = await fetch(`${baseUrl}/api/ingest`, {method:"POST",headers:{"content-type":"application/json","x-news-pulse-job":jobId},body:JSON.stringify({job_id:jobId})});
    if(!response.ok) throw new Error(`Python ingestion failed (${response.status})`);
  }catch(error){
    try { await markFailed(getClient(), jobId, error); } catch {}
  }
}

export async function handle(req,res){
  try{
    const parts = normalizedParts(new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname);
    const client = getClient();
    if(req.method === "GET" && parts[0] === "clusters" && !parts[1]) return res.status(200).json({clusters:await listClusters(client)});
    if(req.method === "GET" && parts[0] === "clusters" && parts[1]){
      const id = parts[1];
      const cluster = await client.from("clusters").select("id,label,article_count,start_time,end_time").eq("id", id).maybeSingle();
      if(cluster.error) throw cluster.error;
      if(!cluster.data) return res.status(404).json({error:"cluster not found"});
      const articles = await client.from("articles").select("id,title,source,published_at,url,summary,body_text").eq("cluster_id", id).order("published_at", {ascending:true});
      if(articles.error) throw articles.error;
      return res.status(200).json({cluster:{...cluster.data, articles:articles.data || []}});
    }
    if(req.method === "GET" && parts[0] === "timeline") return res.status(200).json(await timeline(client));
    if(req.method === "POST" && parts[0] === "ingest" && parts[1] === "trigger"){
      const running = await client.from("ingestion_jobs").select("id").eq("status","running").order("started_at", {ascending:false}).limit(1).maybeSingle();
      if(running.error) throw running.error;
      if(running.data) return res.status(409).json({error:"ingestion already running",job_id:running.data.id});
      const jobId = randomUUID();
      const inserted = await client.from("ingestion_jobs").insert({id:jobId,status:"running",started_at:new Date().toISOString()});
      if(inserted.error) throw inserted.error;
      const origin = new URL(req.url, `http://${req.headers.host || "localhost"}`).origin;
      waitUntil(triggerPython(origin, jobId));
      return res.status(202).json({job_id:jobId,status:"running"});
    }
    if(req.method === "GET" && parts[0] === "ingest" && parts[1] === "status"){
      const jobId = parts[2];
      if(!jobId) return res.status(400).json({error:"job id is required"});
      const job = await client.from("ingestion_jobs").select("id,status,started_at,finished_at,processed_count,error").eq("id",jobId).maybeSingle();
      if(job.error) throw job.error;
      if(!job.data) return res.status(404).json({error:"job not found"});
      return res.status(200).json(job.data);
    }
    return res.status(404).json({error:"route not found"});
  }catch(error){
    console.error(error);
    return res.status(500).json({error:"internal server error",detail:String(error?.message || error)});
  }
}
export default handle;
