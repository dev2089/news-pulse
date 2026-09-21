import { createClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function timeline(supabase) {
  const { data, error } = await supabase.from("clusters").select("id,label,article_count,start_time,end_time").order("start_time",{ascending:false});
  if(error) throw error;
  const items=data||[];
  if(!items.length) return {clusters:[],meta:{mode:"empty"}};
  const ids=items.map(x=>x.id);
  const {data:articleRows,error:articleError}=await supabase.from("articles").select("id,cluster_id,title,source,published_at,url,summary").in("cluster_id",ids);
  if(articleError) throw articleError;
  const byCluster=new Map();
  for(const article of articleRows||[]){const list=byCluster.get(article.cluster_id)||[];list.push(article);byCluster.set(article.cluster_id,list);}
  return {clusters:items.map(c=>{const articles=(byCluster.get(c.id)||[]).sort((a,b)=>new Date(a.published_at)-new Date(b.published_at));return {...c,size:Math.max(1,c.article_count),intensity:Math.log2(c.article_count+1),sources:[...new Set(articles.map(a=>a.source))],articles};}),meta:{mode:"live"}};
}

async function markFailed(supabase,jobId,error){
  await supabase.from("ingestion_jobs").update({status:"failed",finished_at:new Date().toISOString(),error:String(error?.message||error)}).eq("id",jobId);
}

async function runIngestion(baseUrl,jobId){
  try{
    const response=await fetch(`${baseUrl}/api/ingest`,{method:"POST",headers:{"content-type":"application/json","x-news-pulse-job":jobId},body:JSON.stringify({job_id:jobId})});
    if(!response.ok) throw new Error(`Python ingestion failed (${response.status})`);
  }catch(error){
    try{await markFailed(getClient(),jobId,error)}catch{}
  }
}

export async function handle(req,res){
  try{
    const url=new URL(req.url,`http://${req.headers.host||"localhost"}`);
    let route=url.searchParams.get("route"),id=url.searchParams.get("id");
    const parts=url.pathname.split("/").filter(Boolean);
    if(!route){
      if(parts[0]==="clusters"&&parts[1]){route="cluster-detail";id=parts[1]}
      else if(parts[0]==="clusters") route="clusters";
      else if(parts[0]==="timeline") route="timeline";
      else if(parts[0]==="ingest"&&parts[1]==="trigger") route="ingest-trigger";
      else if(parts[0]==="ingest"&&parts[1]==="status"){route="ingest-status";id=parts[2]}
    }

    const supabase=getClient();

    if(req.method==="GET"&&route==="clusters"){
      const {data,error}=await supabase.from("clusters").select("id,label,article_count,start_time,end_time").order("start_time",{ascending:false});
      if(error) throw error;
      return res.status(200).json({clusters:data||[]});
    }

    if(req.method==="GET"&&route==="cluster-detail"){
      if(!id) return res.status(400).json({error:"cluster id is required"});
      const {data,error}=await supabase.from("articles").select("id,title,source,published_at,url,summary,body_text").eq("cluster_id",id).order("published_at",{ascending:true});
      if(error) throw error;
      if(!data?.length) return res.status(404).json({error:"cluster not found or empty"});
      const labelResult=await supabase.from("clusters").select("id,label,article_count,start_time,end_time").eq("id",id).maybeSingle();
      if(labelResult.error) throw labelResult.error;
      return res.status(200).json({cluster:{...labelResult.data,articles:data}});
    }

    if(req.method==="GET"&&route==="timeline") return res.status(200).json(await timeline(supabase));

    if(req.method==="POST"&&route==="ingest-trigger"){
      const running=await supabase.from("ingestion_jobs").select("id").eq("status","running").order("started_at",{ascending:false}).limit(1).maybeSingle();
      if(running.error) throw running.error;
      if(running.data) return res.status(409).json({error:"ingestion already running",job_id:running.data.id});
      const jobId=crypto.randomUUID();
      const {error}=await supabase.from("ingestion_jobs").insert({id:jobId,status:"running",started_at:new Date().toISOString()});
      if(error) throw error;
      waitUntil(runIngestion(url.origin,jobId));
      return res.status(202).json({job_id:jobId,status:"running"});
    }

    if(req.method==="GET"&&route==="ingest-status"){
      if(!id) return res.status(400).json({error:"job id is required"});
      const {data,error}=await supabase.from("ingestion_jobs").select("id,status,started_at,finished_at,processed_count,error").eq("id",id).maybeSingle();
      if(error) throw error;
      if(!data) return res.status(404).json({error:"job not found"});
      return res.status(200).json(data);
    }

    return res.status(404).json({error:"route not found"});
  }catch(error){
    console.error(error);
    return res.status(500).json({error:"internal server error",detail:String(error.message||error)});
  }
}
export default handle;
