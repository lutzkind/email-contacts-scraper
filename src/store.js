const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function nowIso() {
  return new Date().toISOString();
}

function createStore(config) {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  fs.mkdirSync(config.exportsDir, { recursive: true });

  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      targets_json TEXT NOT NULL,
      options_json TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      total_targets INTEGER NOT NULL DEFAULT 0,
      processed_targets INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      artifact_csv_path TEXT,
      artifact_json_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      input TEXT NOT NULL,
      website TEXT,
      status TEXT NOT NULL,
      error TEXT,
      primary_email TEXT,
      emails_json TEXT NOT NULL,
      email_source TEXT,
      contact_page_url TEXT,
      social_links_json TEXT NOT NULL,
      crawled_urls_json TEXT NOT NULL,
      page_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_results_job_id ON results(job_id, id);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
  `);

  resetRunningJobs(db);
  cleanupExpiredSessions(db);

  return {
    createJob({ id, targets, options }) {
      const timestamp = nowIso();
      db.prepare(
        `
          INSERT INTO jobs (
            id, targets_json, options_json, status, message, total_targets,
            created_at, updated_at
          ) VALUES (
            @id, @targetsJson, @optionsJson, 'pending', 'Queued', @totalTargets,
            @timestamp, @timestamp
          )
        `
      ).run({
        id,
        targetsJson: JSON.stringify(targets),
        optionsJson: JSON.stringify(options || {}),
        totalTargets: targets.length,
        timestamp,
      });
    },

    listJobs() {
      return db
        .prepare(`SELECT * FROM jobs ORDER BY created_at DESC`)
        .all()
        .map(deserializeJob);
    },

    getJob(jobId) {
      const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId);
      return row ? deserializeJob(row) : null;
    },

    claimNextJob() {
      const row = db
        .prepare(`SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`)
        .get();
      if (!row) {
        return null;
      }

      const timestamp = nowIso();
      db.prepare(
        `
          UPDATE jobs
          SET status = 'running',
              message = 'Running',
              started_at = COALESCE(started_at, @timestamp),
              updated_at = @timestamp
          WHERE id = @id
        `
      ).run({ id: row.id, timestamp });
      return this.getJob(row.id);
    },

    replaceJobResults(jobId, results) {
      const timestamp = nowIso();
      db.transaction(() => {
        db.prepare(`DELETE FROM results WHERE job_id = ?`).run(jobId);
        const insert = db.prepare(
          `
            INSERT INTO results (
              job_id, input, website, status, error, primary_email, emails_json,
              email_source, contact_page_url, social_links_json, crawled_urls_json,
              page_count, created_at, updated_at
            ) VALUES (
              @jobId, @input, @website, @status, @error, @primaryEmail, @emailsJson,
              @emailSource, @contactPageUrl, @socialLinksJson, @crawledUrlsJson,
              @pageCount, @timestamp, @timestamp
            )
          `
        );

        for (const result of results) {
          insert.run({
            jobId,
            input: result.input,
            website: result.website,
            status: result.status,
            error: result.error,
            primaryEmail: result.primaryEmail,
            emailsJson: JSON.stringify(result.emails || []),
            emailSource: result.emailSource,
            contactPageUrl: result.contactPageUrl,
            socialLinksJson: JSON.stringify(result.socialLinks || {}),
            crawledUrlsJson: JSON.stringify(result.crawledUrls || []),
            pageCount: result.pageCount || 0,
            timestamp,
          });
        }

        db.prepare(
          `
            UPDATE jobs
            SET processed_targets = @processedTargets,
                success_count = @successCount,
                failed_count = @failedCount,
                updated_at = @timestamp
            WHERE id = @jobId
          `
        ).run({
          jobId,
          processedTargets: results.length,
          successCount: results.filter((entry) => entry.status === "ok").length,
          failedCount: results.filter((entry) => entry.status === "failed").length,
          timestamp,
        });
      })();
    },

    finalizeJob(jobId, status, message, artifacts = {}) {
      db.prepare(
        `
          UPDATE jobs
          SET status = @status,
              message = @message,
              artifact_csv_path = COALESCE(@csvPath, artifact_csv_path),
              artifact_json_path = COALESCE(@jsonPath, artifact_json_path),
              finished_at = @timestamp,
              updated_at = @timestamp
          WHERE id = @jobId
        `
      ).run({
        jobId,
        status,
        message,
        csvPath: artifacts.csvPath || null,
        jsonPath: artifacts.jsonPath || null,
        timestamp: nowIso(),
      });
    },

    failJob(jobId, errorMessage) {
      db.prepare(
        `
          UPDATE jobs
          SET status = 'failed',
              message = @message,
              finished_at = @timestamp,
              updated_at = @timestamp
          WHERE id = @jobId
        `
      ).run({ jobId, message: errorMessage, timestamp: nowIso() });
    },

    listResults(jobId, { limit = 100, offset = 0 } = {}) {
      return db
        .prepare(
          `
            SELECT *
            FROM results
            WHERE job_id = ?
            ORDER BY id ASC
            LIMIT ?
            OFFSET ?
          `
        )
        .all(jobId, limit, offset)
        .map(deserializeResult);
    },

    deleteJob(jobId) {
      const job = this.getJob(jobId);
      if (!job) {
        return null;
      }
      db.transaction(() => {
        db.prepare(`DELETE FROM results WHERE job_id = ?`).run(jobId);
        db.prepare(`DELETE FROM jobs WHERE id = ?`).run(jobId);
      })();
      return job;
    },

    createSession({ id, username, expiresAt }) {
      const timestamp = nowIso();
      db.prepare(
        `
          INSERT INTO sessions (
            id, username, expires_at, created_at, last_seen_at
          ) VALUES (?, ?, ?, ?, ?)
        `
      ).run(id, username, expiresAt, timestamp, timestamp);
    },

    getSession(sessionId) {
      const row = db
        .prepare(`SELECT * FROM sessions WHERE id = ? AND expires_at > ?`)
        .get(sessionId, nowIso());
      return row || null;
    },

    touchSession(sessionId, expiresAt) {
      db.prepare(
        `
          UPDATE sessions
          SET expires_at = ?, last_seen_at = ?
          WHERE id = ?
        `
      ).run(expiresAt, nowIso(), sessionId);
    },

    deleteSession(sessionId) {
      db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
    },

    cleanupExpiredSessions() {
      cleanupExpiredSessions(db);
    },
  };
}

function resetRunningJobs(db) {
  db.prepare(
    `
      UPDATE jobs
      SET status = 'pending',
          message = 'Recovered after process restart.',
          updated_at = @timestamp
      WHERE status = 'running'
    `
  ).run({ timestamp: nowIso() });
}

function cleanupExpiredSessions(db) {
  db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).run(nowIso());
}

function deserializeJob(row) {
  return {
    id: row.id,
    targets: JSON.parse(row.targets_json),
    options: JSON.parse(row.options_json),
    status: row.status,
    message: row.message,
    totalTargets: row.total_targets,
    processedTargets: row.processed_targets,
    successCount: row.success_count,
    failedCount: row.failed_count,
    artifactCsvPath: row.artifact_csv_path,
    artifactJsonPath: row.artifact_json_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function deserializeResult(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    input: row.input,
    website: row.website,
    status: row.status,
    error: row.error,
    primaryEmail: row.primary_email,
    emails: JSON.parse(row.emails_json),
    emailSource: row.email_source,
    contactPageUrl: row.contact_page_url,
    socialLinks: JSON.parse(row.social_links_json),
    crawledUrls: JSON.parse(row.crawled_urls_json),
    pageCount: row.page_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  createStore,
};
