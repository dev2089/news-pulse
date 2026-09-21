import hashlib
import html
import math
import os
import re
from collections import Counter
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit

import feedparser
import requests
import trafilatura
from bs4 import BeautifulSoup
from dateutil import parser as date_parser

FEEDS = [
    ("BBC News", "https://feeds.bbci.co.uk/news/rss.xml"),
    ("NPR", "https://feeds.npr.org/1001/rss.xml"),
    ("The Guardian", "https://www.theguardian.com/world/rss"),
]

STOPWORDS = set(
    "a an and are as at be been but by can could for from had has have he her hers him his i if in into is it its just may might more most my of on or our out over said she should so some than that the their them then there these they this to too under up us was we were what when where which who will with would you your after before about against between during each few further how other same such through until while why into upon also because".split()
)
TOKEN_RE = re.compile(r"[a-zA-Z][a-zA-Z0-9']{2,}")

def clean_text(value: str) -> str:
    if not value:
        return ""
    value = html.unescape(value)
    value = BeautifulSoup(value, "html.parser").get_text(" ")
    return re.sub(r"\s+", " ", value).strip()

def canonical_url(url: str) -> str:
    if not url:
        return ""
    parts = urlsplit(url.strip())
    return urlunsplit(
        (parts.scheme.lower() or "https", parts.netloc.lower(), parts.path.rstrip("/"), "", "")
    )

def parse_date(entry) -> str:
    for value in [entry.get("published"), entry.get("updated"), entry.get("created")]:
        if not value:
            continue
        try:
            dt = date_parser.parse(value)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat()
        except Exception:
            continue
    return datetime.now(timezone.utc).isoformat()

def tokens(text: str):
    result = []
    for token in TOKEN_RE.findall(text.lower()):
        token = token.lower()
        if token not in STOPWORDS and not token.isnumeric():
            result.append(token)
    return result

def extract_body(url: str) -> str:
    if not url:
        return ""
    try:
        downloaded = trafilatura.fetch_url(url)
        if downloaded:
            text = trafilatura.extract(
                downloaded,
                include_links=False,
                include_comments=False,
                favor_precision=True,
            )
            if text and len(text.split()) > 40:
                return clean_text(text)
    except Exception:
        pass

    try:
        response = requests.get(
            url,
            headers={"User-Agent": "NewsPulse/1.0 (+assessment demo)"},
            timeout=12,
        )
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        for tag in soup(["script", "style", "noscript", "nav", "footer", "header"]):
            tag.decompose()
        return re.sub(r"\s+", " ", soup.get_text(" ")).strip()[:20000]
    except Exception:
        return ""

def fetch_articles():
    articles = []
    for source, feed_url in FEEDS:
        parsed = feedparser.parse(feed_url)
        for entry in parsed.entries[:30]:
            title = clean_text(entry.get("title", ""))
            url = canonical_url(entry.get("link", ""))
            encoded = entry.get("content") or []
            content_value = encoded[0].get("value", "") if encoded else ""
            summary = clean_text(entry.get("summary") or entry.get("description") or content_value)

            if not title or not url:
                continue

            published_at = parse_date(entry)
            body = extract_body(url)
            dedupe_key = hashlib.sha256(url.encode("utf-8")).hexdigest()

            articles.append(
                {
                    "id": dedupe_key[:24],
                    "dedupe_key": dedupe_key,
                    "title": title,
                    "summary": summary,
                    "body_text": body,
                    "source": source,
                    "url": url,
                    "published_at": published_at,
                }
            )

    return list({a["dedupe_key"]: a for a in articles}.values())

def cosine(a, b):
    keys = set(a) | set(b)
    dot = sum(a.get(k, 0.0) * b.get(k, 0.0) for k in keys)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0

def build_vectors(items):
    docs = [
        tokens(item["title"] + " " + item["summary"] + " " + item["body_text"][:3500])
        for item in items
    ]
    document_frequency = Counter()
    for doc in docs:
        document_frequency.update(set(doc))

    n = max(1, len(docs))
    vectors = []
    for doc in docs:
        counts = Counter(doc)
        total = max(1, len(doc))
        vector = {}
        for term, count in counts.items():
            # TF-IDF-inspired weighting keeps this dependency-free and deterministic.
            idf = 1.0 + math.log((n + 1) / (document_frequency[term] + 1))
            vector[term] = (count / total) * idf
        vectors.append(vector)

    return vectors, docs

def cluster_articles(items):
    items = sorted(items, key=lambda x: x["published_at"])
    if not items:
        return []

    vectors, docs = build_vectors(items)
    groups = []
    assigned = set()
    threshold = 0.27

    for i in range(len(items)):
        if i in assigned:
            continue

        group = [i]
        assigned.add(i)
        changed = True

        while changed:
            changed = False
            group_terms = set().union(*(set(docs[k]) for k in group))
            for j in range(len(items)):
                if j in assigned:
                    continue
                similarity = max((cosine(vectors[j], vectors[k]) for k in group), default=0.0)
                shared = len(set(docs[j]) & group_terms)
                if similarity >= threshold or shared >= 2:
                    group.append(j)
                    assigned.add(j)
                    changed = True
                    group_terms.update(docs[j])

        groups.append(group)

    clusters = []
    for members in groups:
        group_items = [items[idx] for idx in members]
        common = Counter()
        for idx in members:
            common.update(set(docs[idx]))

        label_words = [word for word, _ in common.most_common(3)]
        label = " · ".join(label_words[:3]).title() if label_words else "Untitled topic"
        signature = "|".join(sorted(item["dedupe_key"] for item in group_items))
        cluster_id = "c_" + hashlib.sha1(signature.encode()).hexdigest()[:16]

        clusters.append(
            {
                "id": cluster_id,
                "label": label,
                "article_count": len(group_items),
                "start_time": min(x["published_at"] for x in group_items),
                "end_time": max(x["published_at"] for x in group_items),
                "members": group_items,
            }
        )

    return clusters

def supabase_request(method, path, payload=None, params=None):
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/" + path
    key = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not key:
        raise RuntimeError("SUPABASE_PUBLISHABLE_KEY is required")

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if method in {"POST", "PATCH", "DELETE"}:
        headers["Prefer"] = "return=minimal"

    return requests.request(
        method,
        url,
        headers=headers,
        json=payload,
        params=params,
        timeout=30,
    )

def run(job_id=None):
    articles = list(fetch_articles())

    existing_response = supabase_request(
        "GET", "articles", params={"select": "dedupe_key", "limit": 1000}
    )
    existing_response.raise_for_status()
    existing = {row["dedupe_key"] for row in existing_response.json()}
    new_articles = [article for article in articles if article["dedupe_key"] not in existing]

    for article in new_articles:
        payload = {
            key: article[key]
            for key in [
                "id",
                "dedupe_key",
                "title",
                "summary",
                "body_text",
                "source",
                "url",
                "published_at",
            ]
        }
        response = supabase_request("POST", "articles", payload)
        if response.status_code not in (201, 204):
            response.raise_for_status()

    all_response = supabase_request(
        "GET",
        "articles",
        params={
            "select": "id,dedupe_key,title,summary,body_text,source,url,published_at",
            "order": "published_at.asc",
            "limit": 1000,
        },
    )
    all_response.raise_for_status()
    all_items = all_response.json()
    clusters = cluster_articles(all_items)

    clear_articles = supabase_request(
        "PATCH",
        "articles",
        payload={"cluster_id": None},
        params={"cluster_id": "not.is.null"},
    )
    clear_articles.raise_for_status()

    clear_clusters = supabase_request(
        "DELETE", "clusters", params={"id": "not.is.null"}
    )
    clear_clusters.raise_for_status()

    for cluster in clusters:
        cluster_payload = {
            key: cluster[key]
            for key in ["id", "label", "article_count", "start_time", "end_time"]
        }
        supabase_request("POST", "clusters", cluster_payload).raise_for_status()

        for article in cluster["members"]:
            supabase_request(
                "PATCH",
                "articles",
                payload={"cluster_id": cluster["id"]},
                params={"id": f"eq.{article['id']}"},
            ).raise_for_status()

    if job_id:
        supabase_request(
            "PATCH",
            "ingestion_jobs",
            payload={
                "status": "completed",
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "processed_count": len(new_articles),
            },
            params={"id": f"eq.{job_id}"},
        ).raise_for_status()

    return {
        "processed": len(new_articles),
        "clusters": len(clusters),
        "total_articles": len(all_items),
    }

if __name__ == "__main__":
    print(run(os.environ.get("JOB_ID")))
