# Email Contacts Scraper

Standalone website email scraper that accepts a list of domains or URLs, crawls the website plus likely contact/about/team/location pages using **direct HTML fetch with Crawl4AI fallback** plus an optional **browser-rendered fallback** for blocked or JS-heavy pages, and stores:

- primary email
- all discovered emails
- contact page URL
- social profile links
- crawl status and errors

It is intentionally separate from the Google Maps and OSM lead scrapers.

## API

### Create a job

```bash
curl -X POST http://localhost:3015/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "text": "example.com\nexample.org",
    "concurrency": 2,
    "maxPagesPerSite": 6
  }'
```

### Read jobs and results

```bash
curl http://localhost:3015/jobs
curl http://localhost:3015/jobs/<job-id>
curl http://localhost:3015/jobs/<job-id>/results?limit=100
curl -L "http://localhost:3015/jobs/<job-id>/download?format=csv" -o results.csv
curl -L "http://localhost:3015/jobs/<job-id>/download?format=json" -o results.json
```

## Environment

- `HOST` default `0.0.0.0`
- `PORT` default `3015`
- `DATA_DIR` default `./data`
- `DB_PATH` default `./data/email-contacts-scraper.db`
- `EXPORTS_DIR` default `./data/exports`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `SESSION_COOKIE_NAME` default `email_scraper_session`
- `SESSION_TTL_HOURS` default `24`
- `CRAWL4AI_BASE_URL`
- `CRAWL4AI_BEARER_TOKEN`
- `EMAIL_ENRICHMENT_TIMEOUT_MS` default `20000`
- `EMAIL_ENRICHMENT_MAX_PAGES` default `12`
- `EMAIL_ENRICHMENT_CONCURRENCY` default `2`
- `EMAIL_ENRICHMENT_RETRY_COUNT` default `2`
- `BROWSER_FALLBACK_ENABLED` default `true`
- `BROWSER_FALLBACK_TIMEOUT_MS` default `25000`
- `BROWSER_FALLBACK_WAIT_MS` default `1500`
- `DIRECT_FETCH_USER_AGENT` optional override for direct page fetches

## Local run

```bash
npm install
ADMIN_USERNAME=admin \
ADMIN_PASSWORD=change-me \
CRAWL4AI_BASE_URL=http://127.0.0.1:3130 \
CRAWL4AI_BEARER_TOKEN=... \
npm start
```
