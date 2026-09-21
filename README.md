# News Pulse

**Xponentium India Full-Stack Developer Internship Assessment**

News Pulse pulls current articles from three public RSS feeds, normalizes inconsistent feed fields, extracts article body text when available, removes duplicate URLs across repeated runs, groups related stories into topic clusters, and presents those clusters as a visual timeline.

## Structure

- `/scraper` Python ingestion, extraction, topic grouping
- `/backend` Node.js REST API
- `/frontend` Next.js / React experience
- `/api` Vercel-compatible serverless adapters

## Architecture

`RSS feeds → Python normalizer/extractor → Supabase Postgres → Node REST API → Next.js timeline`

The refresh flow is: `POST /ingest/trigger` creates a job and invokes the Python service; the browser polls `GET /ingest/status/:jobId` and reloads the timeline when the job is complete.

## Topic grouping

The grouping engine uses a lightweight TF-IDF-inspired vector calculation written in Python. It uses headline + summary + a bounded slice of extracted body text, removes stopwords, computes term weights and cosine similarity, then grows clusters when similarity crosses `0.27` or when two meaningful terms are shared. Labels come from the most frequent meaningful terms in each cluster.

Why: the assessment explicitly accepts simple grouping approaches and values coherent results plus a clear explanation. A deterministic implementation keeps the ingestion path inspectable and serverless-friendly.

Limitation: generic vocabulary can occasionally connect unrelated stories, while semantically equivalent stories using different wording may remain separate. Cross-source story merging is intentionally left as a future improvement.

## News sources

- BBC News RSS: `https://feeds.bbci.co.uk/news/rss.xml`
- NPR RSS: `https://feeds.npr.org/1001/rss.xml`
- The Guardian World RSS: `https://www.theguardian.com/world/rss`

## Configuration

Set these as hosting environment variables, never in source control:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

The publishable key is only used for this public assessment dataset. Production hardening would place ingestion behind authenticated server credentials and narrower RLS policies.

## API

- `GET /clusters`
- `GET /clusters/:id`
- `GET /timeline`
- `POST /ingest/trigger`
- `GET /ingest/status/:jobId`

## Deployment

Railway hosts one production Node service containing the Next.js frontend, required Node REST API, and Python ingestion worker. Supabase provides hosted Postgres persistence. Keeping Node and Python in the same runtime makes the required refresh-triggered subprocess flow explicit and testable.

## Video

The required 2–3 minute walkthrough should show the live timeline with current news, grouping logic, one engineering problem and its solution, and one improvement for more time. Record the real deployed app after deployment so the demo is truthful and reproducible.