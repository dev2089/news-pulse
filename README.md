# News Pulse

**Xponentium India Full-Stack Developer Internship Assessment**

News Pulse pulls live articles from three public RSS feeds, normalizes feed inconsistencies, attempts full-page extraction with graceful fallback, prevents repeated URL duplicates, groups related stories into topic clusters, and presents those clusters as a visual timeline.

## Assessment coverage

The implementation directly covers the required Python ingestion/grouping, Node REST API, Next.js/React timeline, refresh + polling flow, hosted database, deployment configuration, README documentation, and video walkthrough plan.

## Repository structure

- `/scraper` Python ingestion, extraction, TF-IDF-inspired topic grouping
- `/backend` Node.js REST API logic
- `/frontend` Next.js / React dashboard
- `/api` Vercel-compatible API adapters
- `/tests` automated Python tests

## Architecture

`RSS feeds → Python normalizer/extractor → Supabase Postgres → Node REST API → Next.js timeline`

The refresh flow is:

`POST /ingest/trigger → job created → background Python function → GET /ingest/status/:jobId polling → timeline reload`

## Topic grouping

A deterministic, lightweight TF-IDF-inspired approach is used. Headline + summary + a bounded slice of extracted body text are tokenized, stopwords are removed, terms are weighted with inverse document frequency, and cosine similarity is compared against a `0.27` threshold. A small shared-term guard helps short but clearly related articles connect. Each cluster receives a label from the most frequent meaningful terms.

Why this approach: the assessment explicitly accepts both keyword overlap and TF-IDF-style approaches and emphasizes coherent output plus clear reasoning. Keeping the implementation dependency-light makes the behavior inspectable and easier to deploy.

### Parameter choice

The similarity threshold was set to `0.27` after considering that news headlines often use different wording while still sharing several topic-specific terms. The shared-term guard uses two meaningful terms to avoid requiring long identical phrases.

### Limitation

Lexical similarity can miss semantically equivalent stories that use different vocabulary and can occasionally connect unrelated stories that share generic terms. Cross-source event merging is intentionally left as a future improvement.

## News sources

- BBC News RSS: `https://feeds.bbci.co.uk/news/rss.xml`
- NPR RSS: `https://feeds.npr.org/1001/rss.xml`
- The Guardian World RSS: `https://www.theguardian.com/world/rss`

The pipeline accepts description/content variants, multiple date fields and missing dates.

## Article extraction

RSS entries normally contain summaries rather than complete articles. The pipeline first attempts extraction with Trafilatura and then falls back to BeautifulSoup. An extraction failure never aborts the whole ingestion run.

## Duplicate + rerun behavior

URLs are canonicalized and hashed into a unique `dedupe_key`. Existing keys are read before insertion, so repeated runs only insert unseen articles. Clusters are then recomputed from the retained corpus so the timeline stays coherent after new items arrive.

## API

- `GET /clusters`
- `GET /clusters/:id`
- `GET /timeline`
- `POST /ingest/trigger`
- `GET /ingest/status/:jobId`

The API uses appropriate 400/404/409/500-level responses, validates required identifiers, and keeps secrets in environment variables.

## Deployment

**Frontend + Node API + Python function: Vercel**
**Database: Supabase Postgres**

Vercel serves the Next.js dashboard and API routes. The Python ingestion function is invoked as a background task from the Node trigger route. Supabase stores articles, clusters, and ingestion jobs.

Environment variables are configured outside the repository:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

No database credentials or secret values are committed to source control.

## Verification

GitHub Actions currently validates the Python tests, Node syntax and production Next.js build. The final live verification checklist covers cold loading, all required API routes, source filtering, cluster detail interaction, refresh/polling behavior, and current feed ingestion.

## Video walkthrough

The required 2–3 minute walkthrough follows the assessment order:

1. Live timeline with current news
2. Grouping logic and code explanation
3. One hard ingestion/grouping problem and the solution
4. One improvement for additional time

The final recording should be made against the deployed app so the demo is truthful.
## Vercel import

The repository is Vercel-ready and uses Vercel’s native Next.js detection. A current import URL is:
https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdev2089%2Fnews-pulse&project-name=news-pulse

Environment variables are supported as deployment overrides. The app also has a documented fallback to the Supabase publishable key so the assessment demo can boot without manual configuration; no secret/service-role key is used.
