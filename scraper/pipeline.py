import hashlib
import html
import math
import os
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit

import feedparser
import requests
from bs4 import BeautifulSoup
from dateutil import parser as date_parser

FEEDS = [
    ("BBC News", "https://feeds.bbci.co.uk/news/rss.xml"),
    ("NPR", "https://feeds.npr.org/1001/rss.xml"),
    ("The Guardian", "https://www.theguardian.com/world/rss"),
]
MAX_ENTRIES_PER_FEED = 12
MAX_BODY_CHARS = 16000
EXTRACTION_WORKERS = 6

GENERIC_NEWS_TERMS = set("news latest says said report reports people world country countries new year years today yesterday monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december image video live read watch time day days week weeks month months one two first second".split())

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
    return urlunsplit((parts.scheme.lower() or "https", parts.netloc.lower(), parts.path.rstrip("/"), "", ""))

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
    return [
        token.lower()
        for token in TOKEN_RE.findall(text.lower())
        if token.lower() not in STOPWORDS and token.lower() not in GENERIC_NEWS_TERMS and not token.isnumeric()
    ]

def extract_body(url: str) -> str:
    if not url:
        return ""
    try:
        response = requests.get(
            url,
            headers={"User-Agent": "NewsPulse/1.0 (+assessment demo)"},
            timeout=8,
        )
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        for tag in soup(["script", "style", "noscript", "nav", "footer", "header", "aside", "form"]):
            tag.decompose()

        article = soup.find("article")
        if article:
            text = clean_text(article.get_text(" "))
            if len(text.split()) > 40:
                return text[:MAX_BODY_CHARS]

        paragraphs = [clean_text(p.get_text(" ")) for p in soup.find_all("p")]
        paragraphs = [p for p in paragraphs if len(p.split()) >= 8]
        text = " ".join(paragraphs)
        if len(text.split()) > 40:
            return text[:MAX_BODY_CHARS]

        return clean_text(soup.get_text(" "))[:MAX_BODY_CHARS]
    except Exception:
        return ""

def parse_feed_entries(source: str, feed_url: str):
    parsed = feedparser.parse(feed_url)
    items = []
    for entry in parsed.entries[:MAX_ENTRIES_PER_FEED]:
        title = clean_text(entry.get("title", ""))
        url = canonical_url(entry.get("link", ""))
        content_items = entry.get("content") or []
        encoded = content_items[0].get("value", "") if content_items else ""
        summary = clean_text(entry.get("summary") or entry.get("description") or encoded)
        if not title or not url:
            continue
        items.append({
            "id": hashlib.sha256(url.encode("utf-8")).hexdigest()[:24],
            "dedupe_key": hashlib.sha256(url.encode("utf-8")).hexdigest(),
            "title": title,
            "summary": summary,
            "body_text": "",
            "source": source,
            "url": url,
            "published_at": parse_date(entry),
        })
    return items

def fetch_metadata():
    articles = []
    with ThreadPoolExecutor(max_workers=min(3, len(FEEDS))) as pool:
        futures = [pool.submit(parse_feed_entries, source, url) for source, url in FEEDS]
        for future in as_completed(futures):
            try:
                articles.extend(future.result())
            except Exception:
                continue
    return list({a["dedupe_key"]: a for a in articles}.values())

def cosine(a, b):
    keys = set(a) | set(b)
    dot = sum(a.get(k, 0.0) * b.get(k, 0.0) for k in keys)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0

def build_vectors(items):
    docs = [tokens(item["title"] + " " + item["summary"] + " " + item["body_text"][:3500]) for item in items]
    document_frequency = Counter()
    for doc in docs:
        document_frequency.update(set(doc))
    n = max(1, len(docs))
    vectors = []
    for doc in docs:
        counts = Counter(doc)
        total = max(1, len(doc))
        vectors.append({
            term: (count / total) * (1.0 + math.log((n + 1) / (document_frequency[term] + 1)))
            for term, count in counts.items()
        })
    return vectors, docs

def cluster_articles(items):
    items = sorted(items, key=lambda x: x["published_at"])
    if not items:
        return []
    vectors, docs = build_vectors(items)
    document_frequency = Counter()
    for doc in docs:
        document_frequency.update(set(doc))
    n = max(1, len(docs))
    groups, assigned = [], set()
    threshold = 0.34

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
                shared_terms = set(docs[j]) & group_terms
                meaningful_shared = len([term for term in shared_terms if document_frequency.get(term, 0) <= max(2, n * 0.45)])
                if similarity >= threshold or meaningful_shared >= 2:
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
        clusters.append({
            "id": "c_" + hashlib.sha1(signature.encode()).hexdigest()[:16],
            "label": label,
            "article_count": len(group_items),
            "start_time": min(x["published_at"] for x in group_items),
            "end_time": max(x["published_at"] for x in group_items),
            "members": group_items,
        })
    return clusters

def supabase_request(method, path, payload=None, params=None):
    url = (os.environ.get("SUPABASE_URL") or "https://smpmvabjafmrutdhbfbl.supabase.co").rstrip("/") + "/rest/v1/" + path
    key = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("SUPABASE_ANON_KEY") or "sb_publishable_E7EU3ofBU4MThptewl5Sbw_e2GrOqjG"
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if method in {"POST", "PATCH", "DELETE"}:
        headers["Prefer"] = "return=minimal"
    return requests.request(method, url, headers=headers, json=payload, params=params, timeout=25)

def extract_new_bodies(new_articles):
    def work(article):
        article["body_text"] = extract_body(article["url"])
        return article
    with ThreadPoolExecutor(max_workers=EXTRACTION_WORKERS) as pool:
        futures = [pool.submit(work, article) for article in new_articles]
        for future in as_completed(futures):
            try:
                future.result()
            except Exception:
                pass

def run(job_id=None):
    metadata = fetch_metadata()

    existing_response = supabase_request("GET", "articles", params={"select": "dedupe_key", "limit": 2000})
    existing_response.raise_for_status()
    existing = {row["dedupe_key"] for row in existing_response.json()}

    new_articles = [article for article in metadata if article["dedupe_key"] not in existing]
    extract_new_bodies(new_articles)

    for article in new_articles:
        response = supabase_request("POST", "articles", payload=article)
        if response.status_code not in (201, 204):
            response.raise_for_status()

    all_response = supabase_request(
        "GET",
        "articles",
        params={
            "select": "id,dedupe_key,title,summary,body_text,source,url,published_at",
            "order": "published_at.asc",
            "limit": 2000,
        },
    )
    all_response.raise_for_status()
    all_items = all_response.json()
    clusters = cluster_articles(all_items)

    clear_articles = supabase_request("PATCH", "articles", payload={"cluster_id": None}, params={"cluster_id": "not.is.null"})
    clear_articles.raise_for_status()
    clear_clusters = supabase_request("DELETE", "clusters", params={"id": "not.is.null"})
    clear_clusters.raise_for_status()

    for cluster in clusters:
        payload = {key: cluster[key] for key in ["id", "label", "article_count", "start_time", "end_time"]}
        supabase_request("POST", "clusters", payload).raise_for_status()
        for article in cluster["members"]:
            supabase_request(
                "PATCH", "articles",
                payload={"cluster_id": cluster["id"]},
                params={"id": f"eq.{article['id']}"}
            ).raise_for_status()

    result = {"processed": len(new_articles), "clusters": len(clusters), "total_articles": len(all_items)}
    if job_id:
        supabase_request(
            "PATCH", "ingestion_jobs",
            payload={"status": "completed", "finished_at": datetime.now(timezone.utc).isoformat(), "processed_count": len(new_articles)},
            params={"id": f"eq.{job_id}"}
        ).raise_for_status()
    return result

if __name__ == "__main__":
    print(run(os.environ.get("JOB_ID")))
