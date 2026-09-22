"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Clock3, ExternalLink, Filter, Loader2, RefreshCw, Rss, Sparkles, X } from "lucide-react";

const fmt = (value) => value
  ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  : "Unknown time";

const ago = (value) => {
  if (!value) return "never";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return String(minutes) + "m ago";
  if (minutes < 1440) return String(Math.round(minutes / 60)) + "h ago";
  return String(Math.round(minutes / 1440)) + "d ago";
};

export default function Dashboard() {
  const [clusters, setClusters] = useState([]);
  const [sources, setSources] = useState([]);
  const [activeSources, setActiveSources] = useState(new Set());
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState("Connecting to live feed…");
  const [updatedAt, setUpdatedAt] = useState(null);
  const autoStarted = useRef(false);

  const loadTimeline = useCallback(async () => {
    try {
      const res = await fetch("/timeline", { cache: "no-store" });
      if (!res.ok) throw new Error("timeline request failed");
      const payload = await res.json();
      const next = Array.isArray(payload?.clusters) ? payload.clusters : [];
      setClusters(next);
      const nextSources = Array.from(new Set(next.flatMap((cluster) => cluster.sources || []))).sort();
      setSources(nextSources);
      setActiveSources((prev) => prev.size ? new Set([...prev].filter((source) => nextSources.includes(source))) : new Set(nextSources));
      setStatus(payload?.meta?.mode === "live" ? "Live data connected" : "Database snapshot");
      setUpdatedAt(new Date());
    } catch {
      setStatus("Live data unavailable · try refresh");
      setUpdatedAt(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshData = useCallback(async () => {
    setRefreshing(true);
    setStatus("Running Python ingestion…");
    try {
      const trigger = await fetch("/ingest/trigger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      if (!trigger.ok) {
        const body = await trigger.json().catch(() => ({}));
        throw new Error(body?.error || "Could not start ingestion");
      }
      const job = await trigger.json();
      for (let i = 0; i < 40; i += 1) {
        const poll = await fetch("/ingest/status/" + job.job_id, { cache: "no-store" });
        const state = await poll.json();
        if (state.status === "completed") break;
        if (state.status === "failed") throw new Error(state.error || "Ingestion failed");
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (i === 39) throw new Error("Ingestion is still running. Check the status endpoint again shortly.");
      }
      await loadTimeline();
      setStatus("Fresh news loaded");
    } catch (error) {
      setStatus(error?.message || "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }, [loadTimeline]);

  useEffect(() => { loadTimeline(); }, [loadTimeline]);

  useEffect(() => {
    if (!loading && clusters.length === 0 && !refreshing && !autoStarted.current) {
      autoStarted.current = true;
      refreshData();
    }
  }, [loading, clusters.length, refreshing, refreshData]);

  useEffect(() => {
    const timer = setInterval(() => loadTimeline(), 60000);
    return () => clearInterval(timer);
  }, [loadTimeline]);

  const visible = useMemo(
    () => clusters.filter((cluster) => (cluster.sources || []).some((source) => activeSources.has(source))),
    [clusters, activeSources]
  );

  const range = useMemo(() => {
    const values = visible.flatMap((c) => [new Date(c.start_time).getTime(), new Date(c.end_time).getTime()]);
    if (!values.length) return { min: Date.now() - 86400000, max: Date.now() };
    return { min: Math.min(...values), max: Math.max(...values) };
  }, [visible]);

  const position = (value) => {
    const span = Math.max(1, range.max - range.min);
    return Math.min(99.2, Math.max(0, ((new Date(value).getTime() - range.min) / span) * 100));
  };

  const totalArticles = visible.reduce((sum, cluster) => sum + Number(cluster.article_count || 0), 0);
  const maxIntensity = Math.max(0, ...visible.map((cluster) => Number(cluster.intensity || 0)));

  function toggleSource(source) {
    setActiveSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }

  return (
    <main className="page">
      <div className="container">
        <header className="topbar">
          <div className="brand">
            <div className="brandMark"><Rss size={21} strokeWidth={2.5} /></div>
            <div>
              <div className="brandEyebrow">XPONENTIUM INDIA · ASSESSMENT</div>
              <div className="brandTitle">News Pulse</div>
            </div>
          </div>
          <button className="refreshButton" onClick={refreshData} disabled={refreshing}>
            {refreshing ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
            {refreshing ? "Refreshing" : "Refresh data"}
          </button>
        </header>

        <section className="hero">
          <div className="heroCopy">
            <div className="statusRow"><span className="liveDot" />{status}</div>
            <h1 className="heroTitle">Read the cycle as <span>stories</span>, not a pile of headlines.</h1>
            <p className="heroText">
              Three public RSS feeds are normalized, de-duplicated and grouped with lightweight TF–IDF-style similarity.
              Each cluster becomes a visible time window you can inspect down to the original article.
            </p>
          </div>

          <div className="heroMetrics">
            <div className="metric">
              <div className="metricLabel">ACTIVE TOPICS</div>
              <div className="metricValue">{visible.length}</div>
              <div className="metricHint"><Activity size={13} /> {Math.round(maxIntensity * 100) / 100} max intensity</div>
            </div>
            <div className="metric">
              <div className="metricLabel">ARTICLES IN VIEW</div>
              <div className="metricValue">{totalArticles}</div>
              <div className="metricHint"><Sparkles size={13} /> automatically clustered</div>
            </div>
          </div>
        </section>

        <section className="filterPanel">
          <div className="filterTitle"><Filter size={15} /> Source filters</div>
          <div className="chips">
            {sources.map((source) => (
              <button key={source} className={"chip " + (activeSources.has(source) ? "chipOn" : "")} onClick={() => toggleSource(source)}>
                {source}
              </button>
            ))}
          </div>
          {updatedAt && <div className="updated"><Clock3 size={13} /> updated {ago(updatedAt)}</div>}
        </section>

        <section className="timelinePanel">
          <div className="timelineHead">
            <div>
              <div className="sectionEyebrow">TOPIC TIMELINE</div>
              <div className="sectionHint">Block width = story window · click to explore</div>
            </div>
            <div className="sectionHint">{visible.length} clusters</div>
          </div>

          {loading ? (
            <div className="emptyState">
              <Loader2 className="spin" />
              <strong>Loading the timeline</strong>
              <span>Pulling the latest stored cluster data.</span>
            </div>
          ) : !visible.length ? (
            <div className="emptyState">
              <strong>No stories match the selected sources.</strong>
              <span>Turn a source back on or run Refresh data.</span>
            </div>
          ) : (
            <div className="timelineBody">
              <div className="timelineStage">
                <div className="axis"><span>{fmt(range.min)}</span><span>{fmt(range.max)}</span></div>
                <div className="grid">{Array.from({ length: 6 }, (_, index) => <span key={index} />)}</div>
                {visible.map((cluster) => {
                  const left = position(cluster.start_time);
                  const right = position(cluster.end_time);
                  const width = Math.max(9, right - left);
                  const active = selected?.id === cluster.id;
                  return (
                    <div className="clusterRow" key={cluster.id}>
                      <div className="rowLabel">
                        <strong>{cluster.label}</strong>
                        <span>{cluster.article_count} articles · {(cluster.sources || []).join(" + ")}</span>
                      </div>
                      <div className="track">
                        <button
                          className={"clusterBar " + (active ? "clusterBarActive" : "")}
                          style={{ left: left + "%", width: Math.min(100 - left, width) + "%" }}
                          onClick={() => setSelected(cluster)}
                          aria-label={"Open " + cluster.label + " cluster"}
                        >
                          <span className="barPulse" />
                          <span className="barLabel">{cluster.label}</span>
                          <span className="barCount">{cluster.article_count}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <section className="infoGrid">
          <div className="infoCard"><div className="infoLabel">INGESTION</div><strong>3 public RSS sources</strong><p>Handles feed field differences, missing dates, article-page extraction failures and duplicate URLs without killing the run.</p></div>
          <div className="infoCard"><div className="infoLabel">GROUPING</div><strong>Deterministic text similarity</strong><p>TF–IDF-inspired vectors plus a rare-term guard prevent generic news vocabulary from swallowing unrelated stories.</p></div>
          <div className="infoCard"><div className="infoLabel">REFRESH FLOW</div><strong>Trigger → job → poll → redraw</strong><p>The UI starts ingestion, polls a job ID, then reloads the timeline. Auto-refresh also checks stored data once per minute.</p></div>
        </section>

        {selected && (
          <aside className="drawer" aria-label="Cluster detail">
            <div className="scrim" onClick={() => setSelected(null)} />
            <div className="drawerPanel">
              <div className="drawerTop">
                <div className="sectionEyebrow">CLUSTER DETAIL</div>
                <button className="close" onClick={() => setSelected(null)} aria-label="Close"><X size={18} /></button>
              </div>
              <h2 className="drawerTitle">{selected.label}</h2>
              <div className="drawerMeta">{selected.article_count} articles · {fmt(selected.start_time)} → {fmt(selected.end_time)}</div>
              <div className="articleList">
                {(selected.articles || []).map((article) => (
                  <article className="article" key={article.id + "-" + article.published_at}>
                    <div className="articleMeta"><span>{article.source}</span><span>{fmt(article.published_at)}</span></div>
                    <h3>{article.title}</h3>
                    {article.summary && <p>{article.summary}</p>}
                    <a className="articleLink" href={article.url} target="_blank" rel="noreferrer">Read original <ExternalLink size={13} /></a>
                  </article>
                ))}
              </div>
              <div className="drawerNote"><Sparkles size={14} /> Label generated from the cluster's meaningful terms.</div>
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}
