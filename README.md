# News Pulse

**Xponentium India · Full-Stack Developer Internship Assessment**  
**Project:** Topic-Clustered News Timeline

News Pulse turns live RSS entries into a browsable story timeline. Three public news feeds are normalized into one article schema, article pages are fetched for fuller text when possible, URLs are canonicalized for rerun-safe deduplication, and articles are grouped with a deterministic TF–IDF-inspired similarity model. The React interface then renders each cluster as a time window and lets the reviewer inspect the underlying articles.

## What is included

- `/scraper` Python RSS ingestion, article extraction, deduplication and clustering.
- `/backend` Node.js REST API and ingestion job orchestration.
- `/app` Next.js application shell.
- `/frontend` React dashboard component with a neumorphic UI.
- `/api` Vercel adapters, including a catch-all Node route and the Python ingestion function.
- `/tests` focused regression tests for normalization and clustering.
- `.github/workflows/ci.yml` automated Python tests plus production build checks.

## Architecture

```text
BBC RSS ─┐
NPR RSS ─┼─> Python normalizer/extractor ─> TF–IDF-style grouping ─> Supabase Postgres
Guardian ─┘                                                           │
                                                                      ▼
                                                           Node REST API
                                                                      │
                                                                      ▼
                                                               Next.js / React
                                                                      │
                                                                      ▼
                                                        Neumorphic story timeline
```

### Refresh lifecycle

```text
POST /ingest/trigger
        │
        ▼
   job row = running
        │
        ▼
 Python ingestion function
        │
        ├── fetch RSS metadata
        ├── fetch article pages
        ├── dedupe new URLs
        ├── recompute topic clusters
        └── update job = completed / failed
        │
        ▼
GET /ingest/status/:jobId  ← frontend polls
        │
        ▼
GET /timeline             ← redraw
```

## Topic grouping

The implementation uses a lightweight, deterministic TF–IDF-style approach rather than a heavier embedding service.

1. Headline, RSS summary and a bounded slice of extracted body text become the document.
2. Stopwords and generic news vocabulary are removed.
3. Terms receive TF–IDF-like weights.
4. Cosine similarity is compared against `0.34` with a rare-term guard.
5. A looser path allows strong lexical evidence (`>= 0.24` plus three rare shared terms), two meaningful title terms, or very strong similarity (`>= 0.52`).
6. Articles are compared with every member of an existing cluster before joining, limiting accidental “topic drift” caused by one weak bridge article.
7. A 21-day time window prevents unrelated stories separated by long periods from being connected only because of vocabulary.

The clustering logic is intentionally explainable. The assessment explicitly accepts either keyword-overlap or TF–IDF approaches, and asks for a clear explanation of parameters and at least one limitation.

### Limitation

This is still lexical clustering. Two articles describing the same real-world event with very different vocabulary can remain separate, while unrelated articles can occasionally share enough terms to appear related. Cross-source event merging is therefore treated as a future enhancement rather than pretending semantic understanding is perfect.

## News sources

- **BBC News:** `https://feeds.bbci.co.uk/news/rss.xml`
- **NPR:** `https://feeds.npr.org/1001/rss.xml`
- **The Guardian World:** `https://www.theguardian.com/world/rss`

The parser accepts multiple common RSS field shapes (`summary`, `description`, `content`) and multiple date fields (`published`, `updated`, `created`, `date`). Invalid or missing dates fall back to the current UTC time so one malformed entry cannot break the run.

## Article extraction

RSS normally exposes a short summary rather than the full article. For each new entry the scraper attempts to retrieve the original page and extract article text from:

- `<article>`
- `<main>`
- `[itemprop="articleBody"]`
- paragraph aggregation

Extraction failures return an empty body instead of aborting the ingestion job.

## Duplicate and rerun behavior

The URL is canonicalized by removing query strings and fragments, normalizing scheme/host casing, and trimming trailing slashes. A SHA-256 digest becomes the `dedupe_key` and the article ID prefix. Existing keys are checked before inserts, so repeated runs do not duplicate an article.

Clusters are recomputed from the retained article corpus after new items are added. This keeps the timeline coherent as new articles arrive.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/clusters` | Cluster list with label, count and time range |
| GET | `/clusters/:id` | Full cluster detail with chronological articles |
| GET | `/timeline` | Timeline-ready cluster objects with time range, count, intensity and sources |
| POST | `/ingest/trigger` | Starts a new ingestion job; returns a job ID |
| GET | `/ingest/status/:jobId` | Returns job state and processed count |

The API returns `400` for missing required IDs, `404` for unknown resources, `409` for a concurrent ingestion attempt, and `500` for unexpected server/database failures.

## Environment variables

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

No service-role key is required by the application path. The Node API and Python pipeline require `SUPABASE_URL` plus `SUPABASE_PUBLISHABLE_KEY` (or the legacy anon-key variable) from the deployment environment. No database URL or key is committed to the repository.

## Database shape

The Supabase database contains three News Pulse tables:

- `articles`: normalized source article records and cluster assignment.
- `clusters`: derived topic labels and earliest/latest timestamps.
- `ingestion_jobs`: refresh job state and counts.

The assessment allows Postgres, MongoDB or SQLite, so Supabase Postgres keeps the deployment path simple while remaining compatible with the requested stack.

## Local run

Install Node 22+ and Python 3.11+.

```bash
npm install
python -m pip install -r scraper/requirements.txt
npm run dev
```

Open `http://localhost:3000`.

The custom local server exposes the same Node routes used by the frontend and can launch the Python pipeline through `/api/ingest`. Set the Supabase environment variables before running a live ingestion locally.

Useful checks:

```bash
npm run test
npm run typecheck
npm run build
```

## Deployment

The repository is structured for a Vercel deployment:

- Next.js UI is detected from the root `app/` directory.
- Node API routes are exposed through `/api/[...path].js`.
- `api/ingest.py` is the Python serverless function.
- `vercel.json` limits the ingestion function to a short assessment-friendly execution window.
- Environment variables are configured on the hosting platform instead of committed as secrets.

The assessment asks for a live frontend URL and a live backend URL. Those URLs should be copied into the final submission only after a successful deployment and a cold-load/API smoke test.

## Verification checklist

Before submission:

- [ ] Dashboard opens from a cold browser session.
- [ ] `/clusters` returns JSON.
- [ ] `/timeline` returns timeline-ready data.
- [ ] Clicking a cluster opens its article detail view.
- [ ] Source chips hide/show the appropriate clusters.
- [ ] `Refresh data` starts a job, polls its status, and redraws after completion.
- [ ] Repeated ingestion does not duplicate URLs.
- [ ] One malformed RSS entry or failed article-page extraction does not crash the run.
- [ ] Production build passes CI.
- [ ] A 2–3 minute walkthrough is recorded from the deployed app.

## Video walkthrough plan

The required walkthrough is intentionally aligned with the assessment order:

1. **0:00–0:40** Live demo: show current clusters, click one cluster, open an original article, toggle a source.
2. **0:40–1:30** Grouping logic: explain normalization, TF–IDF-style weighting, similarity thresholds and the rare-term guard.
3. **1:30–2:10** Hard problem: show how inconsistent RSS fields and article extraction failures are handled without stopping the whole run.
4. **2:10–2:30** Next improvement: semantic cross-source event merging and richer extraction heuristics.

A ready-to-read script is included in `docs/video-script.md`.

## Assessment mapping

The implementation is intentionally mapped one-to-one with the supplied brief: Python ingestion/grouping, Node API endpoints, timeline + cluster detail + source filter + refresh/polling, hosted deployment structure, README documentation, and the required video walkthrough are all represented in the repository. The final live URLs and recorded walkthrough must be added after successful deployment/recording.
