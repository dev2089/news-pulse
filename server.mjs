import express from "express";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import next from "next";
import { createClient } from "@supabase/supabase-js";

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
const dev=process.env.NODE_ENV!=="production";
const nextApp=next({dev,dir:path.join(__dirname,"frontend")});
const nextHandler=nextApp.getRequestHandler();
const supabase=createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY,
  {auth:{persistSession:false}}
);

const pythonCommand=process.platform==="win32"?"python":"python3";
let activeJobId=null;

async function listClusters(){
  const {data,error}=await supabase.from("clusters").select("id,label,article_count,start_time,end_time").order("start_time",{ascending:false});
  if(error) throw error;
  return data||[];
}

async function clusterDetail(id){
  const cluster=await supabase.from("clusters").select("id,label,article_count,start_time,end_time").eq("id",id).maybeSingle();
  if(cluster.error) throw cluster.error;
  if(!cluster.data) return null;
  const articles=await supabase.from("articles").select("id,title,source,published_at,url,summary,body_text").eq("cluster_id",id).order("published_at",{ascending:true});
  if(articles.error) throw articles.error;
  return {...cluster.data,articles:articles.data||[]};
}

async function timeline(){
  const clusters=await listClusters();
  if(!clusters.length) return {clusters:[],meta:{mode:"empty"}};
  const ids=clusters.map(c=>c.id);
  const {data,error}=await supabase.from("articles").select("id,cluster_id,title,source,published_at,url,summary").in("cluster_id",ids);
  if(error) throw error;
  const map=new Map();
  for(const a of data||[]){const list=map.get(a.cluster_id)||[];list.push(a);map.set(a.cluster_id,list)}
  return {clusters:clusters.map(c=>{
    const articles=(map.get(c.id)||[]).sort((a,b)=>new Date(a.published_at)-new Date(b.published_at));
    return {...c,size:Math.max(1,c.article_count),intensity:Math.log2(c.article_count+1),sources:[...new Set(articles.map(a=>a.source))],articles};
  }),meta:{mode:"live"}};
}

function startIngestion(){
  const jobId=crypto.randomUUID();
  activeJobId=jobId;
  return (async()=>{
    const startedAt=new Date().toISOString();
    const inserted=await supabase.from("ingestion_jobs").insert({id:jobId,status:"running",started_at:startedAt});
    if(inserted.error){activeJobId=null;throw inserted.error}
    const child=spawn(pythonCommand,["-m","scraper.pipeline"],{
      cwd:__dirname,
      env:{...process.env,JOB_ID:jobId},
      stdio:["ignore","pipe","pipe"]
    });
    child.stdout.on("data",chunk=>process.stdout.write("[python] "+chunk.toString()));
    child.stderr.on("data",chunk=>process.stderr.write("[python] "+chunk.toString()));
    child.on("error",async error=>{
      await supabase.from("ingestion_jobs").update({status:"failed",finished_at:new Date().toISOString(),error:String(error.message||error)}).eq("id",jobId);
      if(activeJobId===jobId)activeJobId=null;
    });
    child.on("close",async code=>{
      if(code!==0){
        await supabase.from("ingestion_jobs").update({status:"failed",finished_at:new Date().toISOString(),error:`Python pipeline exited with code ${code}`}).eq("id",jobId);
      }
      if(activeJobId===jobId)activeJobId=null;
    });
    return jobId;
  })();
}

await nextApp.prepare();
const app=express();
app.disable("x-powered-by");
app.use(express.json({limit:"32kb"}));

app.get("/health",async(req,res)=>res.status(200).json({ok:true,service:"news-pulse"}));

app.get("/clusters",async(req,res)=>{
  try{res.status(200).json({clusters:await listClusters()})}
  catch(error){console.error(error);res.status(500).json({error:"internal server error"})}
});

app.get("/clusters/:id",async(req,res)=>{
  try{const cluster=await clusterDetail(req.params.id);if(!cluster)return res.status(404).json({error:"cluster not found"});return res.status(200).json({cluster})}
  catch(error){console.error(error);return res.status(500).json({error:"internal server error"})}
});

app.get("/timeline",async(req,res)=>{
  try{return res.status(200).json(await timeline())}
  catch(error){console.error(error);return res.status(500).json({error:"internal server error"})}
});

app.post("/ingest/trigger",async(req,res)=>{
  try{
    if(activeJobId)return res.status(409).json({error:"ingestion already running",job_id:activeJobId});
    const jobId=await startIngestion();
    return res.status(202).json({job_id:jobId,status:"running"});
  }catch(error){console.error(error);return res.status(500).json({error:"could not start ingestion"})}
});

app.get("/ingest/status/:jobId",async(req,res)=>{
  try{
    const {data,error}=await supabase.from("ingestion_jobs").select("id,status,started_at,finished_at,processed_count,error").eq("id",req.params.jobId).maybeSingle();
    if(error)throw error;
    if(!data)return res.status(404).json({error:"job not found"});
    return res.status(200).json(data);
  }catch(error){console.error(error);return res.status(500).json({error:"internal server error"})}
});

app.use((req,res)=>nextHandler(req,res));
const port=Number(process.env.PORT||3000);
app.listen(port,"0.0.0.0",()=>console.log(`News Pulse listening on ${port}`));
