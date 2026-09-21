# News Pulse — 2–3 Minute Walkthrough

## 0:00–0:40 — Live demo
Open the deployed app on a cold load. Point out the live feed status, active topic count, timeline blocks and source filters. Click one timeline block to open the cluster drawer and show headline, source, publication time and original link. Click Refresh Data and show the job flow until the timeline updates.

## 0:40–1:30 — How grouping works
Open `scraper/pipeline.py`. Explain:
1. Three public RSS feeds are normalized into one schema.
2. The full article page is attempted with Trafilatura, with BeautifulSoup as a graceful fallback.
3. URLs are canonicalized and hashed so repeated runs do not insert the same story twice.
4. Headline, summary and bounded body text become weighted term vectors.
5. Cosine similarity plus a small shared-term guard grows topic clusters.
6. The label is generated from the most frequent meaningful terms.

The important design choice is determinism and inspectability instead of an opaque heavy model.

## 1:30–2:10 — Hard problem
Show the messy RSS + article-extraction path. Explain that feeds disagree on fields and dates, and some article pages block extraction. The pipeline treats extraction as best-effort so one bad page cannot crash the run. The database keeps the normalized article even when body extraction fails.

## 2:10–2:30 — One improvement
Say: “With more time, I would add stronger semantic embeddings and cross-source event merging, then measure cluster coherence against a small labeled evaluation set.”

Do not claim manual curation or fake usage numbers. The demo should use the real deployed application and current feed output.
