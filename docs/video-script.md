# News Pulse · 2–3 minute walkthrough script

0:00–0:40 · Live demo

“Here’s News Pulse. The page starts with a live connection state and shows topic clusters rather than a flat feed of headlines. Each raised bar represents a cluster window from the earliest article to the latest article. I can filter by BBC News, NPR, or The Guardian, and clicking a bar opens the full cluster detail. From here I can inspect the source, publication time, summary, and the original article link.”

0:40–1:30 · Topic grouping

“Behind the UI, three RSS feeds are normalized into one internal article schema. I clean the text, accept multiple RSS field shapes, parse several date fields, canonicalize URLs, and only insert unseen URLs. For topic grouping, I use deterministic TF–IDF-style term weights and cosine similarity. I also add a rare-term guard and a small title-overlap rule. The important design decision is that a new article is compared against every member of a candidate cluster rather than trusting a single bridge article. That reduces accidental topic drift while keeping the algorithm lightweight and explainable.”

1:30–2:10 · Hard problem

“The messy part is that feeds do not agree on exactly the same fields and original article pages do not always expose their text in the same HTML structure. The pipeline therefore tries article, main, articleBody, then paragraph extraction. If one page fails, its body simply stays empty and the rest of the batch continues. That makes the ingestion rerunnable and resilient instead of turning one bad page into a failed refresh.”

2:10–2:30 · Next improvement

“With more time I would add semantic cross-source event merging. The current system intentionally stays lexical so the behavior remains transparent and dependency-light. Embeddings or a small event-resolution layer could connect stories that refer to the same real-world event even when the wording is very different.”
