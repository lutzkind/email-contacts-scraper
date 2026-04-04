const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { createAuth } = require("./auth");

function createApp({ store, config, emailEnricher }) {
  const app = express();
  const auth = createAuth({ store, config });

  app.use(express.json({ limit: "2mb" }));
  app.use("/assets", express.static(path.join(__dirname, "..", "public")));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, crawl4aiConfigured: emailEnricher.isConfigured() });
  });

  app.get("/", (req, res) => {
    if (!auth.isConfigured()) {
      return res.redirect("/dashboard");
    }
    return res.redirect(auth.currentSession(req) ? "/dashboard" : "/login");
  });

  app.get("/login", (req, res) => {
    if (!auth.isConfigured()) {
      return res.redirect("/dashboard");
    }
    if (auth.currentSession(req)) {
      return res.redirect("/dashboard");
    }
    res.sendFile(path.join(__dirname, "..", "public", "login.html"));
  });

  app.post("/api/auth/login", (req, res) => auth.handleLogin(req, res));
  app.post("/api/auth/logout", withAuth(auth), (req, res) => auth.handleLogout(req, res));
  app.get("/api/auth/session", withAuth(auth), (req, res) => {
    res.json({
      authenticated: true,
      username: req.authSession.username,
      expiresAt: req.authSession.expiresAt,
    });
  });

  app.get("/dashboard", withAuth(auth), (_req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "dashboard.html"));
  });

  app.use("/jobs", withAuth(auth));

  app.get("/jobs", (_req, res) => {
    res.json({ jobs: store.listJobs() });
  });

  app.post("/jobs", (req, res) => {
    if (!emailEnricher.isConfigured()) {
      return res.status(400).json({
        error: "Crawl4AI is not configured on the server.",
      });
    }

    const targets = collectTargets(req.body || {});
    if (targets.length === 0) {
      return res.status(400).json({
        error: "Provide urls, domains, or text containing domains/URLs.",
      });
    }

    const id = crypto.randomUUID();
    const options = {
      concurrency: clampInt(req.body?.concurrency, config.emailEnrichmentConcurrency, 1, 10),
      maxPagesPerSite: clampInt(req.body?.maxPagesPerSite, config.emailEnrichmentMaxPages, 1, 20),
      timeoutMs: clampInt(req.body?.timeoutMs, config.emailEnrichmentTimeoutMs, 1000, 120000),
    };

    store.createJob({ id, targets, options });
    res.status(202).json({
      job: store.getJob(id),
      links: buildLinks(req, config, id),
    });
  });

  app.get("/jobs/:jobId", (req, res) => {
    const job = store.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found." });
    }
    res.json({
      job,
      links: buildLinks(req, config, job.id),
    });
  });

  app.get("/jobs/:jobId/results", (req, res) => {
    const job = store.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found." });
    }
    const limit = Math.min(clampInt(req.query.limit, 100, 1, 1000), 1000);
    const offset = clampInt(req.query.offset, 0, 0, 1000000);
    res.json({
      jobId: job.id,
      limit,
      offset,
      results: store.listResults(job.id, { limit, offset }),
    });
  });

  app.get("/jobs/:jobId/download", (req, res) => {
    const job = store.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found." });
    }
    const format = String(req.query.format || "csv").toLowerCase();
    const filePath = format === "json" ? job.artifactJsonPath : job.artifactCsvPath;
    if (!filePath) {
      return res.status(409).json({ error: "Artifacts are not ready yet." });
    }
    return res.download(filePath);
  });

  app.delete("/jobs/:jobId", (req, res) => {
    const job = store.deleteJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found." });
    }
    res.json({ ok: true, deletedJob: job });
  });

  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({
      error: error.message || "Unexpected error.",
    });
  });

  return app;
}

function withAuth(auth) {
  return (req, res, next) => auth.requireAuth(req, res, next);
}

function collectTargets(body) {
  return [
    ...new Set(
      []
        .concat(body.urls || [])
        .concat(body.domains || [])
        .concat(splitLines(body.text))
        .map((value) => cleanString(value))
        .filter(Boolean)
    ),
  ];
}

function splitLines(value) {
  return String(value || "")
    .split(/\r?\n|,|;/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildLinks(req, config, jobId) {
  const baseUrl = config.publicBaseUrl || `${req.protocol}://${req.get("host")}`;
  return {
    self: `${baseUrl}/jobs/${jobId}`,
    results: `${baseUrl}/jobs/${jobId}/results`,
    csv: `${baseUrl}/jobs/${jobId}/download?format=csv`,
    json: `${baseUrl}/jobs/${jobId}/download?format=json`,
    dashboard: `${baseUrl}/dashboard?jobId=${jobId}`,
  };
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function cleanString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

module.exports = {
  createApp,
};
