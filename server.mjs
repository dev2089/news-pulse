import express from "express";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import next from "next";
import handleBackend from "./backend/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dev = process.env.NODE_ENV !== "production";
const appNext = next({ dev, dir: __dirname });
const nextHandler = appNext.getRequestHandler();

await appNext.prepare();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

app.post("/api/ingest", (req, res) => {
  const jobId = req.headers["x-news-pulse-job"] || req.body?.job_id || process.env.JOB_ID;
  const python = process.platform === "win32" ? "python" : "python3";
  const child = spawn(python, ["-m", "scraper.pipeline"], {
    cwd: __dirname,
    env: { ...process.env, JOB_ID: jobId || "" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => process.stdout.write("[python] " + chunk));
  child.stderr.on("data", (chunk) => process.stderr.write("[python] " + chunk));
  child.on("error", (error) => {
    if (!res.headersSent) res.status(500).json({ ok: false, error: String(error.message || error) });
  });
  child.on("close", (code) => {
    if (!res.headersSent) res.status(code === 0 ? 200 : 500).json({ ok: code === 0, job_id: jobId || null });
  });
});

app.all(["/clusters", "/clusters/:id", "/timeline", "/ingest/trigger", "/ingest/status/:jobId"], (req, res) => handleBackend(req, res));
app.all("/api/clusters", (req, res) => handleBackend(req, res));
app.all("/api/clusters/:id", (req, res) => handleBackend(req, res));
app.all("/api/timeline", (req, res) => handleBackend(req, res));
app.all("/api/ingest/trigger", (req, res) => handleBackend(req, res));
app.all("/api/ingest/status/:jobId", (req, res) => handleBackend(req, res));

app.use((req, res) => nextHandler(req, res));

const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => console.log("News Pulse listening on http://localhost:" + port));
