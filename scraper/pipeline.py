import hashlib
import html
import math
import os
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit, urlunsplit

try:
    import feedparser
except ImportError:
    feedparser = None
try:
    import requests
except ImportError:
    requests = None
try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None
try:
    from dateutil import parser as date_parser
except ImportError:
    date_parser = None
from email.utils import parsedate_to_datetime

FEEDS = [
    ("BBC News", "https://feeds.bbci.co.uk/news/rss.xml"),
    ("NPR", "https://feeds.npr.org/1001/rss.xml"),
    ("The Guardian", "https://www.theguardian.com/world/rss"),
]
MAX_ENTRIES_PER_FEED = 15
MAX_BODY_CHARS = 16000
EXTRACTION_WORKERS = 6
CLUSTER_WINDOW_DAYS = 21
SIMILARITY_THRESHOLD = 0.34
STRONG_SIMILARITY = 0.52

STOPWORDS = set("""
a an and are as at be been but by can could did do does for from had has have he her hers him his how i if in into is it its just may me might more most my of on or our out over she should so some than that the their them then there these they this those through to too under up us was we were what when where which who will with would you your after against before between during each few further same such until while why also because per via very much many much one two three four five six seven eight nine ten says said report reports news latest world today yesterday tomorrow year years new live read watch time day days week weeks month months image video story stories people country countries
""".split())
GENERIC = set("""
news update latest says said reports report people world country countries today monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december image video live read watch time day days week weeks month months one two three four five six seven eight nine ten first second third officials official source sources according amid says told new major latest story stories
""".split())
TOKEN_RE = re.compile(r"[a-zA-Z][a-zA-Z0-9']{2,}")


def clean_text(value: str) -> str:
    if not value:
        return ""
    value = html.unescape(str(value))
    if BeautifulSoup is not None:
        text = BeautifulSoup(value, "html.parser").get_text(" ")
    else:
        text = re.sub(r"<[^>]+>", " ", value)
    text = text.replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def canonical_url(url: str) -> str:
    if not url:
        return ""
    parts = urlsplit(str(url).strip())
    scheme = (parts.scheme or "https").lower()
    host = parts.netloc.lower()
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((scheme, host, path, "", ""))


def parse_date(entry) -> str:
    for value in (entry.get("published"), entry.get("updated"), entry.get("created"), entry.get("date")):
        if not value:
            continue
        try:
            dt = date_parser.parse(str(value)) if date_parser is not None else parsedate_to_datetime(str(value))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat()
        except (ValueError, TypeError, OverflowError):
            continue
    return datetime.now(timezone.utc).isoformat()


def tokens(text: str):
    out = []
    for raw in TOKEN_RE.findall(text.lower()):
        token = raw.strip("'")
        if token in STOPWORDS or token in GENERIC or token.isnumeric():
            continue
        out.append(token)
    return out


def extract_body(url: str) -> str:
    if requests is None or BeautifulSoup is None:
        return ""
    try:
        response = requests.get(url, headers={"User-Agent":"NewsPulse/2.0 (+assessment demo)"}, timeout=8)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        for tag in soup(["script", "style", "noscript", "svg", "nav", "footer", "header", "aside", "form"]):
            tag.decompose()

        for selector in ("article", "main", '[itemprop="articleBody"]'):
            node = soup.select_one(selector)
            if node:
                body = clean_text(node.get_text(" "))
                if len(body.split()) >= 45:
                    return body[:MAX_BODY_CHARS]

        paragraphs = [clean_text(p.get_text(" ")) for p in soup.find_all("p")]
        paragraphs = [p for p in paragraphs if len(p.split()) >= 8]
        return " ".join(paragraphs)[:MAX_BODY_CHARS]
    except Exception:
        return ""


def parse_feed_entries(source: str, feed_url: str):
    if feedparser is None:
        return []
    parsed = feedparser.parse(feed_url)
    entries = []
    for entry in parsed.entries[:MAX_ENTRIES_PER_FEED]:
        title = clean_text(entry.get("title", ""))
        url = canonical_url(entry.get("link", ""))
        content = entry.get("content") or []
        encoded = content[0].get("value", "") if content else ""
        summary = clean_text(entry.get("summary") or entry.get("description") or encoded)
        if not title or not url:
            continue
        dedupe = hashlib.sha256(url.encode("utf-8")).hexdigest()
        entries.append({
            "id": dedupe[:24],
            "dedupe_key": dedupe,
            "title": title,
            "summary": summary,
            "body_text": "",
            "source": source,
            "url": url,
            "published_at": parse_date(entry),
        })
    return entries


def fetch_metadata():
    articles = []
    with ThreadPoolExecutor(max_workers=len(FEEDS)) as pool:
        futures = [pool.submit(parse_feed_entries, source, url) for source, url in FEEDS]
        for future in as_completed(futures):
            try:
                articles.extend(future.result())
            except Exception:
                continue
    return list({article["dedupe_key"]: article for article in articles}.values())


def build_vectors(items):
    docs = [tokens(f"{item['title']} {item['summary']} {item['body_text'][:3500]}") for item in items]
    df = Counter()
    for doc in docs:
        df.update(set(doc))
    n = max(1, len(docs))
    vectors = []
    for doc in docs:
        counts = Counter(doc)
        total = max(1, len(doc))
        vectors.append({term:(count/total) * (1 + math.log((n + 1)/(df[term] + 1))) for term,count in counts.items()})
    return vectors, docs, df


def cosine(a,b):
    if not a or not b:
        return 0.0
    if len(a) < len(b):
        a,b = b,a
    dot = sum(weight * b.get(term,0.0) for term,weight in a.items())
    na = math.sqrt(sum(weight*weight for weight in a.values()))
    nb = math.sqrt(sum(weight*weight for weight in b.values()))
    return dot/(na*nb) if na and nb else 0.0


def rare_overlap(doc_a, doc_b, df, n):
    shared = set(doc_a) & set(doc_b)
    return {term for term in shared if df.get(term,0) <= max(2, int(math.ceil(n*0.18)))}


def should_join(article_i, article_j, doc_i, doc_j, vec_i, vec_j, df, n):
    t_i = datetime.fromisoformat(article_i["published_at"].replace("Z","+00:00"))
    t_j = datetime.fromisoformat(article_j["published_at"].replace("Z","+00:00"))
    if abs(t_i - t_j) > timedelta(days=CLUSTER_WINDOW_DAYS):
        return False
    similarity = cosine(vec_i, vec_j)
    rare = rare_overlap(doc_i, doc_j, df, n)
    title_overlap = set(tokens(article_i["title"])) & set(tokens(article_j["title"]))
    return (
        (similarity >= SIMILARITY_THRESHOLD and len(rare) >= 1)
        or (similarity >= 0.24 and len(rare) >= 3)
        or (len(title_overlap) >= 2)
        or similarity >= STRONG_SIMILARITY
    )


def label_for(members, docs, df):
    n = len(docs)
    label_noise = GENERIC | STOPWORDS | set("sues sue sued challenges challenge hits hit says told warns warned urged urges accused accuses arrested arrest charged charge causes causing killed killing dies died being amid after over into against from say report reports".split())
    term_score = Counter()
    title_occurrence = Counter()
    named_score = Counter()
    named_occurrence = Counter()

    def flush(run):
        if not run:
            return
        for size in (1,2,3):
            if len(run) < size:
                continue
            candidate = tuple(x.lower() for x in run[-size:])
            if candidate[0] in {"the","a","an","this","that"}:
                continue
            named_occurrence[candidate] += 1
            named_score[candidate] += sum(1.0 + math.log((n+1)/(df.get(term,0)+1)) for term in candidate)

    def add_named_phrases(text, allow_sentence_start):
        for sentence in re.split(r"(?<=[.!?])\s+", text or ""):
            raw_tokens = TOKEN_RE.findall(sentence)
            run=[]
            for idx, token in enumerate(raw_tokens):
                low=token.lower().strip("'")
                looks_named = token.isupper() or (token[:1].isupper() and low not in label_noise and (allow_sentence_start or idx>0))
                if looks_named and low not in label_noise and not low.isnumeric():
                    run.append(token)
                else:
                    flush(run)
                    run=[]
            flush(run)

    for article, _doc in members:
        title=article.get("title", "")
        summary=article.get("summary", "")
        for term in set(tokens(title)):
            title_occurrence[term] += 1
            if term not in label_noise:
                term_score[term] += 1.4 + math.log((n+1)/(df.get(term,0)+1))
        add_named_phrases(title, True)
        add_named_phrases(summary, False)

    for term,count in title_occurrence.items():
        if count >= 2:
            term_score[term] += 2.0

    named_candidates=[]
    for phrase,score in named_score.items():
        if len(phrase)==1 and named_occurrence[phrase] < 2 and df.get(phrase[0],0) > 2:
            continue
        named_candidates.append((score+2.5*named_occurrence[phrase],phrase))
    named_candidates.sort(reverse=True)

    selected=[]
    used=set()
    for _score,phrase in named_candidates:
        if any(term in used for term in phrase):
            continue
        selected.append(phrase)
        used.update(phrase)
        if len(selected)>=2:
            break

    term_candidates=[]
    for term,score in term_score.items():
        if term in used or df.get(term,0) > max(3,int(math.ceil(n*0.45))):
            continue
        term_candidates.append((score,term))
    term_candidates.sort(reverse=True)
    if term_candidates:
        selected.append((term_candidates[0][1],))

    if not selected:
        return "Emerging topic"

    def display_word(word):
        if word.lower() in {"cnn","npr","un","unga","uk","us","usa","eu","ai","bbc"}:
            return word.upper()
        return word.title()

    return " · ".join(" ".join(display_word(word) for word in part) for part in selected[:3])


def cluster_articles(items):
    items = sorted(items, key=lambda x:x["published_at"])
    if not items:
        return []
    vectors, docs, df = build_vectors(items)
    clusters=[]
    for idx, article in enumerate(items):
        best=None
        for cluster in clusters:
            candidates=[]
            for member_idx in cluster["indices"]:
                if should_join(article,items[member_idx],docs[idx],docs[member_idx],vectors[idx],vectors[member_idx],df,len(items)):
                    candidates.append(cosine(vectors[idx],vectors[member_idx]))
            if candidates:
                score=max(candidates)
                if best is None or score > best[0]:
                    best=(score,cluster)
        if best:
            best[1]["indices"].append(idx)
        else:
            clusters.append({"indices":[idx]})

    result=[]
    for cluster in clusters:
        members=[items[i] for i in cluster["indices"]]
        pairs=[(article,docs[i]) for article,i in zip(members,cluster["indices"])]
        signature="|".join(sorted(article["dedupe_key"] for article in members))
        result.append({
            "id":"c_"+hashlib.sha1(signature.encode()).hexdigest()[:12],
            "label":label_for(pairs,docs,df),
            "article_count":len(members),
            "start_time":min(article["published_at"] for article in members),
            "end_time":max(article["published_at"] for article in members),
            "members":members,
        })
    return result


def supabase_request(method, path, payload=None, params=None):
    base=(os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key=os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not base or not key:
        raise RuntimeError("Supabase environment variables are missing")
    headers={"apikey":key,"Authorization":f"Bearer {key}","Content-Type":"application/json"}
    if method in {"POST","PATCH","DELETE"}: headers["Prefer"]="return=minimal"
    if requests is None:
        raise RuntimeError("requests dependency is required for live ingestion")
    return requests.request(method, f"{base}/rest/v1/{path}", headers=headers, json=payload, params=params, timeout=25)


def extract_new_bodies(articles):
    def work(article):
        article["body_text"]=extract_body(article["url"])
        return article
    with ThreadPoolExecutor(max_workers=EXTRACTION_WORKERS) as pool:
        futures=[pool.submit(work,article) for article in articles]
        for future in as_completed(futures):
            try: future.result()
            except Exception: pass


def run(job_id=None):
    metadata=fetch_metadata()
    existing_response=supabase_request("GET","articles",params={"select":"dedupe_key","limit":2000})
    existing_response.raise_for_status()
    existing={row["dedupe_key"] for row in existing_response.json()}
    new_articles=[article for article in metadata if article["dedupe_key"] not in existing]
    extract_new_bodies(new_articles)

    for article in new_articles:
        response=supabase_request("POST","articles",article)
        if response.status_code not in (201,204):
            response.raise_for_status()

    all_response=supabase_request("GET","articles",params={"select":"id,dedupe_key,title,summary,body_text,source,url,published_at","order":"published_at.asc","limit":2000})
    all_response.raise_for_status()
    all_items=all_response.json()
    clusters=cluster_articles(all_items)

    clear_articles=supabase_request("PATCH","articles",{"cluster_id":None},{"cluster_id":"not.is.null"})
    clear_articles.raise_for_status()
    clear_clusters=supabase_request("DELETE","clusters",None,{"id":"not.is.null"})
    clear_clusters.raise_for_status()

    for cluster in clusters:
        supabase_request("POST","clusters",{key:cluster[key] for key in ("id","label","article_count","start_time","end_time")}).raise_for_status()
        for article in cluster["members"]:
            supabase_request("PATCH","articles",{"cluster_id":cluster["id"]},{"id":f"eq.{article['id']}"}).raise_for_status()

    result={"processed":len(new_articles),"clusters":len(clusters),"total_articles":len(all_items)}
    if job_id:
        supabase_request("PATCH","ingestion_jobs",{"status":"completed","finished_at":datetime.now(timezone.utc).isoformat(),"processed_count":len(new_articles)},{"id":f"eq.{job_id}"}).raise_for_status()
    return result


if __name__ == "__main__":
    print(run(os.environ.get("JOB_ID")))
