const fs = require("fs");
const path = require("path");

function writeArtifacts(store, config, jobId) {
  const results = store.listResults(jobId, { limit: 1000000000, offset: 0 });
  const targetDir = path.join(config.exportsDir, jobId);
  fs.mkdirSync(targetDir, { recursive: true });

  const csvPath = path.join(targetDir, "results.csv");
  const jsonPath = path.join(targetDir, "results.json");
  const headers = [
    "input",
    "website",
    "status",
    "primary_email",
    "all_emails",
    "email_source",
    "contact_page_url",
    "social_links_json",
    "page_count",
    "error",
  ];

  const rows = results.map((result) => [
    result.input,
    result.website,
    result.status,
    result.primaryEmail,
    (result.emails || []).join(" | "),
    result.emailSource,
    result.contactPageUrl,
    JSON.stringify(result.socialLinks || {}),
    result.pageCount,
    result.error,
  ]);

  const csv = [headers.join(","), ...rows.map((row) => row.map(escapeCsv).join(","))];
  fs.writeFileSync(csvPath, `${csv.join("\n")}\n`, "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2), "utf8");
  return { csvPath, jsonPath };
}

function escapeCsv(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

module.exports = {
  writeArtifacts,
};
