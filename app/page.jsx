"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Clock3, ExternalLink, Filter, Loader2, RefreshCw, Rss, Sparkles, X } from "lucide-react";
import styles from "./page.module.css";

function fmtTime(value){if(!value)return"Unknown time";return new Intl.DateTimeFormat("en",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value))}
function timeAgo(value){const delta=Math.max(0,Date.now()-new Date(value).getTime())/60000;if(delta<60)return`${Math.round(delta)}m ago`;if(delta<1440)return`${Math.round(delta/60)}h ago`;return`${Math.round(delta/1440)}d ago`}

export default function Home(){
  const[clusters,setClusters]=useState([]),[selected,setSelected]=useState(null),[sources,setSources]=useState([]),[activeSources,setActiveSources]=useState(new Set()),[loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false),[status,setStatus]=useState("Connecting to live news data…"),[lastUpdated,setLastUpdated]=useState(null);

  const loadTimeline=useCallback(async()=>{
    try{
      const res=await fetch("/timeline",{cache:"no-store"});if(!res.ok)throw new Error("timeline request failed");
      const data=await res.json();const next=Array.isArray(data?.clusters)?data.clusters:[];
      if(next.length){setClusters(next);setSources(Array.from(new Set(next.flatMap(c=>c.sources||[]))).sort());setStatus(data.meta?.mode==="live"?"Live feed connected":"Database snapshot");setLastUpdated(new Date());return}
      throw new Error("empty dataset");
    }catch{setClusters([]);setSources([]);setStatus("Live data unavailable · ingestion will retry");setLastUpdated(new Date())}
    finally{setLoading(false)}
  },[]);
  useEffect(()=>{loadTimeline()},[loadTimeline]);
  const autoStarted=useRef(false);
  useEffect(()=>{if(!activeSources.size&&sources.length)setActiveSources(new Set(sources))},[sources,activeSources]);
  useEffect(()=>{if(!loading&&clusters.length===0&&!refreshing&&!autoStarted.current){autoStarted.current=true;refreshData()}},[loading,clusters.length,refreshing]);

  const visibleClusters=useMemo(()=>clusters.filter(c=>{const clusterSources=new Set(c.sources||[]);if(!activeSources.size)return true;return[...clusterSources].some(s=>activeSources.has(s))}),[clusters,activeSources]);
  const range=useMemo(()=>{const values=visibleClusters.flatMap(c=>[new Date(c.start_time).getTime(),new Date(c.end_time).getTime()]);if(!values.length)return{min:Date.now()-86400000,max:Date.now()};return{min:Math.min(...values),max:Math.max(...values)}},[visibleClusters]);
  function position(value){const span=Math.max(1,range.max-range.min);return`${((new Date(value).getTime()-range.min)/span)*100}%`}

  async function refreshData(){
    setRefreshing(true);setStatus("Starting ingestion pipeline…");
    try{
      const trigger=await fetch("/ingest/trigger",{method:"POST"});if(!trigger.ok)throw new Error("Could not start ingestion");
      const job=await trigger.json();
      if(job.job_id){
        for(let i=0;i<30;i++){
          const res=await fetch(`/ingest/status/${job.job_id}`,{cache:"no-store"}),state=await res.json();
          if(state.status==="completed")break;if(state.status==="failed")throw new Error(state.error||"Ingestion failed");
          await new Promise(r=>setTimeout(r,1500));
        }
      }
      await loadTimeline();setStatus("Fresh news loaded");
    }catch(error){setStatus(error.message||"Refresh failed")}finally{setRefreshing(false)}
  }
  function toggleSource(source){setActiveSources(prev=>{const next=new Set(prev);next.has(source)?next.delete(source):next.add(source);return next})}

  return <main className={styles.shell}>
    <div className={styles.ambient}/>
    <header className={styles.header}>
      <div className={styles.brandRow}><div className={styles.logo}><Rss size={17} strokeWidth={2.4}/></div><div><div className={styles.kicker}>NEWS PULSE</div><div className={styles.titleLine}>Topic intelligence, in time.</div></div></div>
      <button className={styles.refresh} onClick={refreshData} disabled={refreshing}>{refreshing?<Loader2 size={16} className={styles.spin}/>:<RefreshCw size={16}/>} {refreshing?"Refreshing":"Refresh data"}</button>
    </header>

    <section className={styles.hero}>
      <div><div className={styles.eyebrow}><span className={styles.liveDot}/> {status}</div><h1>See the news cycle as <span>stories</span>, not headlines.</h1><p>Live articles become topic clusters, then stretch across a readable timeline so you can see what started, what is still active, and which stories share the same vocabulary.</p></div>
      <div className={styles.statCard}><div className={styles.statLabel}>ACTIVE TOPICS</div><div className={styles.statValue}>{visibleClusters.length.toString().padStart(2,"0")}</div><div className={styles.statMeta}><Sparkles size={14}/> clustered automatically</div></div>
    </section>

    <section className={styles.filterBar}>
      <div className={styles.filterTitle}><Filter size={15}/> Sources</div>
      <div className={styles.chips}>{sources.map(source=><button key={source} className={`${styles.chip} ${activeSources.has(source)?styles.chipOn:""}`} onClick={()=>toggleSource(source)}>{source}</button>)}</div>
      {lastUpdated&&<div className={styles.updated}><Clock3 size={14}/> updated {timeAgo(lastUpdated)}</div>}
    </section>

    <section className={styles.timelineCard}>
      <div className={styles.timelineHeader}><div><span className={styles.sectionLabel}>LIVE TIMELINE</span><span className={styles.sectionHint}> · wider blocks mean longer story windows</span></div><div className={styles.axisLegend}><span/> newer →</div></div>
      {loading?<div className={styles.empty}><Loader2 className={styles.spin}/> loading timeline…</div>:visibleClusters.length===0?<div className={styles.empty}><span>Waiting for live stories…</span><small>News Pulse automatically starts ingestion when the timeline is empty.</small></div>:<div className={styles.timelineViewport}>
        <div className={styles.axis}><span>{fmtTime(range.min)}</span><span>{fmtTime(range.max)}</span></div><div className={styles.gridLines}><i/><i/><i/><i/><i/></div>
        {visibleClusters.map((cluster,index)=>{const left=position(cluster.start_time),right=position(cluster.end_time),width=Math.max(8,parseFloat(right)-parseFloat(left)),active=selected?.id===cluster.id;return <button key={cluster.id} className={`${styles.cluster} ${active?styles.clusterActive:""}`} style={{left,width:`${width}%`,top:`${index*88+26}px`}} onClick={()=>setSelected(cluster)}><span className={styles.clusterDot}/><span className={styles.clusterLabel}>{cluster.label}</span><span className={styles.clusterCount}>{cluster.article_count} articles</span><span className={styles.clusterWindow}>{fmtTime(cluster.start_time)} → {fmtTime(cluster.end_time)}</span></button>})}
        <div className={styles.timeMarker} style={{left:"100%"}}/>
      </div>}
    </section>

    <section className={styles.footerGrid}>
      <div className={styles.microCard}><div>INGESTION</div><strong>3+ public RSS feeds</strong><span>normalized, deduped, rerunnable</span></div>
      <div className={styles.microCard}><div>GROUPING</div><strong>TF–IDF-inspired similarity</strong><span>lightweight text math, deterministic thresholds</span></div>
      <div className={styles.microCard}><div>EXPLORER</div><strong>Click any story window</strong><span>headline, source, timestamp, original link</span></div>
    </section>

    {selected&&<aside className={styles.drawer}><div className={styles.drawerBackdrop} onClick={()=>setSelected(null)}/><div className={styles.drawerPanel}>
      <div className={styles.drawerTop}><span className={styles.drawerKicker}>TOPIC CLUSTER</span><button className={styles.iconBtn} onClick={()=>setSelected(null)}><X size={19}/></button></div>
      <h2>{selected.label}</h2><p className={styles.drawerMeta}>{selected.article_count} articles · {fmtTime(selected.start_time)} to {fmtTime(selected.end_time)}</p>
      <div className={styles.articleList}>{(selected.articles||[]).slice().sort((a,b)=>new Date(a.published_at)-new Date(b.published_at)).map(article=><article className={styles.article} key={`${article.url}-${article.published_at}`}><div className={styles.articleTop}><span>{article.source}</span><time>{fmtTime(article.published_at)}</time></div><h3>{article.title}</h3><a href={article.url} target="_blank" rel="noreferrer">Read original <ExternalLink size={14}/></a></article>)}</div>
      <div className={styles.drawerFoot}><ArrowUpRight size={16}/> cluster generated from article text, not hand-curated labels</div>
    </div></aside>}
  </main>;
}
