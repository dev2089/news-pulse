import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from scraper.pipeline import canonical_url, clean_text, cluster_articles, cosine


def test_clean_text_strips_html():
    assert clean_text("<p>Hello&nbsp;world</p>") == "Hello world"


def test_canonical_url_removes_query_and_fragment():
    assert canonical_url("HTTPS://Example.COM/path/?utm=1#news") == "https://example.com/path"


def test_cosine_identity():
    assert abs(cosine({"news": 1.0}, {"news": 1.0}) - 1.0) < 1e-9


def test_cluster_articles_groups_related_headlines():
    rows = [
        {"id":"1","dedupe_key":"1","title":"Markets rally after central bank rate decision","summary":"investors digest rate decision markets","body_text":"","source":"A","url":"https://a/1","published_at":"2026-09-21T01:00:00+00:00"},
        {"id":"2","dedupe_key":"2","title":"Investors react to central bank rate decision","summary":"markets respond to rate decision","body_text":"","source":"B","url":"https://b/2","published_at":"2026-09-21T02:00:00+00:00"},
        {"id":"3","dedupe_key":"3","title":"Football club announces new manager","summary":"club confirms appointment","body_text":"","source":"C","url":"https://c/3","published_at":"2026-09-21T03:00:00+00:00"},
    ]
    clusters = cluster_articles(rows)
    sizes = sorted([cluster["article_count"] for cluster in clusters], reverse=True)
    assert sizes[0] == 2
    assert sum(sizes) == 3
