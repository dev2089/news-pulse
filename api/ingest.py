from flask import Flask, jsonify, request
import traceback
from scraper.pipeline import run, supabase_request

app = Flask(__name__)

@app.post("/")
def ingest():
    job_id = request.headers.get("x-news-pulse-job") or (request.get_json(silent=True) or {}).get("job_id")
    try:
        result = run(job_id)
        return jsonify({"ok": True, **result}), 200
    except Exception as exc:
        if job_id:
            try:
                from datetime import datetime, timezone
                supabase_request(
                    "PATCH",
                    "ingestion_jobs",
                    payload={
                        "status": "failed",
                        "finished_at": datetime.now(timezone.utc).isoformat(),
                        "error": str(exc),
                    },
                    params={"id": f"eq.{job_id}"},
                )
            except Exception:
                pass
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(exc)}), 500

@app.post("/api/ingest")
def ingest_prefixed():
    return ingest()
