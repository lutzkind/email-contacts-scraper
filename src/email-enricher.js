const CONTACT_PATH_HINTS = [
  "/contact",
  "/contact.html",
  "/contact-us",
  "/contact-us/",
  "/about",
  "/about-us",
  "/team",
  "/staff",
  "/our-story",
  "/locations",
  "/locations-1",
  "/location",
  "/press",
  "/media",
  "/careers",
  "/support",
  "/help",
  "/catering",
  "/private-events",
  "/events",
  "/impressum",
  "/imprint",
  "/legal",
];

const CONTACT_LINK_HINT =
  /(contact|about|team|staff|support|help|impressum|imprint|legal|company|location|visit|story|cater|event|reservation|faq|connect|press|media|member|leadership|management|people|directory)/i;
const HIGH_SIGNAL_PAGE_HINT =
  /(team|staff|story|about|location|locations|press|leadership|management|people|directory)/i;
const CONTEXTUAL_CHILD_PATH_HINT =
  /(team-member|staff|member|leadership|management|people|bio|profile|location|locations)/i;
const EMAIL_REGEX = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}\b/gi;
const PLACEHOLDER_EMAILS = new Set([
  "email@example.com",
  "user@domain.com",
  "name@example.com",
  "example@example.com",
  "your@email.com",
]);
const INVALID_EMAIL_TLDS = new Set([
  "avif",
  "css",
  "facebook",
  "gif",
  "ico",
  "instagram",
  "jpeg",
  "jpg",
  "js",
  "linkedin",
  "png",
  "svg",
  "tiktok",
  "twitter",
  "webp",
  "x",
  "youtube",
]);
const THIRD_PARTY_EMAIL_DOMAINS = [
  "tambourine.com",
  "mailchimp.com",
  "constantcontact.com",
  "squarespace.com",
  "godaddy.com",
  "wix.com",
  "toasttab.com",
];
const SOCIAL_HOSTS = [
  ["facebook", ["facebook.com"]],
  ["instagram", ["instagram.com"]],
  ["linkedin", ["linkedin.com"]],
  ["x", ["x.com", "twitter.com"]],
  ["youtube", ["youtube.com", "youtu.be"]],
  ["tiktok", ["tiktok.com"]],
  ["telegram", ["t.me", "telegram.me", "telegram.org"]],
  ["whatsapp", ["wa.me", "whatsapp.com"]],
  ["github", ["github.com"]],
  ["crunchbase", ["crunchbase.com"]],
];
let browserPromise = null;

function createEmailEnricher({ config }) {
  return {
    isConfigured() {
      return true;
    },

    async scrapeUrls(urls, options = {}) {
      const limit = clampInt(
        options.concurrency,
        config.emailEnrichmentConcurrency,
        1,
        10
      );
      const normalized = urls.map(normalizeWebsiteUrl).filter(Boolean);
      return mapWithConcurrency(normalized, limit, (url) =>
        scrapeWebsite(url, config, options)
      );
    },
  };
}

async function scrapeWebsite(inputUrl, config, options = {}) {
  const website = normalizeWebsiteUrl(inputUrl);
  if (!website) {
    return buildResult({
      input: inputUrl,
      website: null,
      status: "failed",
      error: "Invalid website URL.",
    });
  }

  const maxPages = clampInt(
    options.maxPagesPerSite,
    config.emailEnrichmentMaxPages,
    1,
    30
  );
  const queue = buildSeedQueue(website, maxPages);
  const queued = new Set(queue.map((entry) => entry.url));
  const crawledUrls = [];
  const crawledUrlSet = new Set();
  const emailOrder = [];
  const emailSet = new Set();
  const socialLinks = {};
  let firstError = null;
  let contactPageUrl = null;
  let browserFallbackUsed = false;

  const discoveredUrls = await discoverSeedUrls(website, config, options);
  for (const candidate of discoveredUrls) {
    if (queued.has(candidate.url)) {
      continue;
    }
    queued.add(candidate.url);
    queue.push(candidate);
  }

  while (queue.length > 0 && crawledUrls.length < maxPages) {
    queue.sort((left, right) => right.priority - left.priority);
    const { url: currentUrl } = queue.shift();
    if (crawledUrlSet.has(currentUrl)) {
      continue;
    }
    let html = "";
    try {
      const fetchedPage = await fetchPageHtml(currentUrl, config, options, {
        allowBrowserFallback:
          !browserFallbackUsed &&
          (currentUrl === website ||
            isHighSignalPage(currentUrl) ||
            /\/(press|media|location|locations|contact|about|team|staff|story|careers)(?:\/|$)/i.test(
              new URL(currentUrl).pathname
            )),
      });
      html = fetchedPage.html;
      if (fetchedPage.usedBrowserFallback) {
        browserFallbackUsed = true;
      }
    } catch (error) {
      if (!firstError) {
        firstError = error;
      }
      continue;
    }

    crawledUrls.push(currentUrl);
    crawledUrlSet.add(currentUrl);
    const extracted = extractContactsFromHtml(html, currentUrl, website);
    for (const email of extracted.emails) {
      if (!emailSet.has(email)) {
        emailSet.add(email);
        emailOrder.push(email);
      }
    }
    for (const [network, link] of Object.entries(extracted.socialLinks)) {
      if (!socialLinks[network]) {
        socialLinks[network] = link;
      }
    }
    if (!contactPageUrl && extracted.contactPageUrl) {
      contactPageUrl = extracted.contactPageUrl;
    }
    for (const candidate of extracted.contactLinks) {
      if (queued.has(candidate.url) || crawledUrlSet.has(candidate.url)) {
        continue;
      }
      if (queued.size >= maxPages * 6) {
        break;
      }
      queued.add(candidate.url);
      queue.push(candidate);
    }
  }

  const sortedEmails = sortEmailsForSite(emailOrder, website);
  const primaryEmail = sortedEmails[0] || null;
  return buildResult({
    input: inputUrl,
    website,
    status:
      primaryEmail || Object.keys(socialLinks).length > 0
        ? "ok"
        : firstError && crawledUrls.length === 0
          ? "failed"
          : "no_contacts",
    error:
      primaryEmail ||
      Object.keys(socialLinks).length > 0 ||
      !firstError ||
      crawledUrls.length > 0
        ? null
        : firstError.message,
    emails: sortedEmails,
    primaryEmail,
    emailSource: primaryEmail ? "website_crawl" : null,
    contactPageUrl,
    socialLinks,
    crawledUrls,
    pageCount: crawledUrls.length,
  });
}

function buildResult(input) {
  return {
    input: input.input || null,
    website: input.website || null,
    status: input.status || "failed",
    error: input.error || null,
    emails: Array.isArray(input.emails) ? input.emails : [],
    primaryEmail: input.primaryEmail || null,
    emailSource: input.emailSource || null,
    contactPageUrl: input.contactPageUrl || null,
    socialLinks: input.socialLinks || {},
    crawledUrls: Array.isArray(input.crawledUrls) ? input.crawledUrls : [],
    pageCount: input.pageCount || 0,
  };
}

async function fetchPageHtml(url, config, options, behavior = {}) {
  const directErrorMessages = [];
  const retryCount = clampInt(
    options.retryCount,
    config.emailEnrichmentRetryCount,
    1,
    5
  );

  for (let attempt = 0; attempt < retryCount; attempt += 1) {
    try {
      const directHtml = await fetchDirectHtml(url, config, options);
      if (directHtml) {
        return { html: directHtml, usedBrowserFallback: false };
      }
    } catch (error) {
      directErrorMessages.push(error.message);
    }
  }

  try {
    return {
      html: await fetchCrawl4aiHtml(url, config, options),
      usedBrowserFallback: false,
    };
  } catch (crawl4aiError) {
    if (behavior.allowBrowserFallback && config.browserFallbackEnabled) {
      try {
        return {
          html: await fetchBrowserHtml(url, config, options),
          usedBrowserFallback: true,
        };
      } catch (browserError) {
        directErrorMessages.push(`Browser fallback failed (${browserError.message})`);
      }
    }
    const prefix = directErrorMessages.length
      ? `Direct fetch failed (${directErrorMessages.join(" | ")}). `
      : "";
    throw new Error(`${prefix}${crawl4aiError.message}`);
  }
}

async function discoverSeedUrls(rootUrl, config, options) {
  const discovered = new Map();
  for (const candidate of await discoverSitemapUrls(rootUrl, config, options)) {
    const priority = scoreCandidateLink(candidate, "", rootUrl);
    if (priority <= 0 || !isSameSite(candidate, rootUrl) || isAssetUrl(candidate)) {
      continue;
    }
    discovered.set(candidate, Math.max(priority + 5, discovered.get(candidate) || 0));
  }
  return [...discovered.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([url, priority]) => ({ url, priority }));
}

async function fetchDirectHtml(url, config, options) {
  const controller = new AbortController();
  const timeoutMs = clampInt(
    options.timeoutMs,
    config.emailEnrichmentTimeoutMs,
    1000,
    120000
  );
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": config.directFetchUserAgent,
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}.`);
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("html")) {
      throw new Error(`Non-HTML content-type ${contentType || "unknown"} for ${url}.`);
    }
    const html = await response.text();
    if (!cleanString(html)) {
      throw new Error(`Direct fetch returned empty HTML for ${url}.`);
    }
    ensureHtmlIsUsable(html, url, "Direct fetch");
    return html;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCrawl4aiHtml(url, config, options) {
  if (!cleanString(config.crawl4aiBaseUrl)) {
    throw new Error(`No fetch strategy succeeded for ${url}.`);
  }

  const controller = new AbortController();
  const timeoutMs = clampInt(
    options.timeoutMs,
    config.emailEnrichmentTimeoutMs,
    1000,
    120000
  );
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${config.crawl4aiBaseUrl.replace(/\/+$/, "")}/html`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(cleanString(config.crawl4aiBearerToken)
          ? { Authorization: `Bearer ${config.crawl4aiBearerToken}` }
          : {}),
      },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Crawl4AI returned ${response.status} for ${url}.`);
    }

    const payload = await response.json();
    const html = cleanString(payload.html) || cleanString(payload.cleaned_html);
    if (!html) {
      throw new Error(`Crawl4AI returned no HTML for ${url}.`);
    }
    ensureHtmlIsUsable(html, url, "Crawl4AI");
    return html;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextResource(url, config, options, acceptHeader) {
  const controller = new AbortController();
  const timeoutMs = clampInt(
    options.timeoutMs,
    config.emailEnrichmentTimeoutMs,
    1000,
    120000
  );
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: acceptHeader,
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent": config.directFetchUserAgent,
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}.`);
    }
    const text = await response.text();
    if (!cleanString(text)) {
      throw new Error(`Empty response for ${url}.`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBrowserHtml(url, config, options) {
  const timeoutMs = clampInt(
    options.browserTimeoutMs,
    config.browserFallbackTimeoutMs,
    1000,
    120000
  );
  const waitMs = clampInt(
    options.browserWaitMs,
    config.browserFallbackWaitMs,
    0,
    15000
  );
  const browser = await getBrowserInstance();
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: config.directFetchUserAgent,
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    if (waitMs > 0) {
      await page.waitForTimeout(waitMs);
    }
    const html = await page.content();
    if (!cleanString(html)) {
      throw new Error(`Browser returned empty HTML for ${url}.`);
    }
    if (looksLikeBlockedHtml(html)) {
      throw new Error(`Browser hit an anti-bot challenge for ${url}.`);
    }
    return html;
  } finally {
    await context.close();
  }
}

async function getBrowserInstance() {
  if (!browserPromise) {
    browserPromise = import("playwright")
      .then(({ chromium }) =>
        chromium.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        })
      )
      .catch((error) => {
        browserPromise = null;
        throw error;
      });
  }
  return browserPromise;
}

async function discoverSitemapUrls(rootUrl, config, options) {
  const sitemapUrls = new Set([new URL("/sitemap.xml", rootUrl).toString()]);
  try {
    const robotsTxt = await fetchTextResource(
      new URL("/robots.txt", rootUrl).toString(),
      config,
      options,
      "text/plain,*/*;q=0.8"
    );
    for (const line of robotsTxt.split(/\r?\n/)) {
      const match = line.match(/^\s*sitemap:\s*(\S+)/i);
      if (!match) {
        continue;
      }
      const resolved = resolveUrl(match[1], rootUrl);
      if (resolved && isSameSite(resolved, rootUrl)) {
        sitemapUrls.add(resolved);
      }
    }
  } catch {}

  const pages = new Set();
  const visited = new Set();
  const queue = [...sitemapUrls].map((url) => ({ url, depth: 0 }));
  while (queue.length > 0 && visited.size < 8) {
    const current = queue.shift();
    if (!current || visited.has(current.url)) {
      continue;
    }
    visited.add(current.url);
    let xml = "";
    try {
      xml = await fetchTextResource(
        current.url,
        config,
        options,
        "application/xml,text/xml,text/plain,*/*;q=0.8"
      );
    } catch {
      continue;
    }
    for (const location of extractXmlLocations(xml)) {
      if (!isSameSite(location, rootUrl)) {
        continue;
      }
      if (/\.xml(?:[?#].*)?$/i.test(location) && current.depth < 2) {
        queue.push({ url: location, depth: current.depth + 1 });
        continue;
      }
      pages.add(location);
    }
  }
  return [...pages];
}

function extractContactsFromHtml(html, pageUrl, rootUrl) {
  const emails = [];
  const emailSet = new Set();
  const socialLinks = {};
  const contactLinkScores = new Map();
  let contactPageUrl = null;

  for (const email of extractEmails(html)) {
    if (!emailSet.has(email)) {
      emailSet.add(email);
      emails.push(email);
    }
  }

  const anchorRegex = /<a\b([^>]*?)href\s*=\s*["']([^"'#]+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRegex.exec(html))) {
    const href = decodeHtmlEntities(match[2]);
    if (!href) {
      continue;
    }

    if (/^mail(?:to)?:/i.test(href)) {
      for (const email of extractEmails(href)) {
        if (!emailSet.has(email)) {
          emailSet.add(email);
          emails.push(email);
        }
      }
      if (!contactPageUrl) {
        contactPageUrl = pageUrl;
      }
      continue;
    }

    const resolved = resolveUrl(href, pageUrl);
    if (!resolved) {
      continue;
    }

    const anchorText = cleanAnchorText(match[4]);
    const network = detectSocialNetwork(resolved);
    if (network && !socialLinks[network]) {
      socialLinks[network] = resolved;
    }

    const priority = scoreCandidateLink(resolved, anchorText, rootUrl, pageUrl);
    if (priority > 0 && isSameSite(resolved, rootUrl) && !isAssetUrl(resolved)) {
      contactLinkScores.set(
        resolved,
        Math.max(priority, contactLinkScores.get(resolved) || 0)
      );
      if (!contactPageUrl && priority >= 70) {
        contactPageUrl = resolved;
      }
    }
  }

  const contactLinks = [...contactLinkScores.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([url, priority]) => ({ url, priority }));

  return { emails, socialLinks, contactLinks, contactPageUrl };
}

function buildSeedQueue(website, maxPages) {
  const queue = [];
  const queued = new Set();
  const root = normalizeWebsiteUrl(website);
  if (!root) {
    return queue;
  }
  queue.push({ url: root, priority: 120 });
  queued.add(root);
  for (const suffix of CONTACT_PATH_HINTS) {
    if (queue.length >= maxPages * 4) {
      break;
    }
    const candidate = new URL(suffix, root).toString();
    if (!queued.has(candidate)) {
      queued.add(candidate);
      queue.push({
        url: candidate,
        priority: scoreCandidateLink(candidate, suffix, root),
      });
    }
  }
  return queue;
}

function extractEmails(value) {
  const source = String(value || "");
  const normalizedSource = source
    .replace(/\s*(?:\[at\]|\(at\)|\{at\})\s*/gi, "@")
    .replace(/\s*(?:\[dot\]|\(dot\)|\{dot\})\s*/gi, ".")
    .replace(/\s+/g, " ");
  const emails = new Set((normalizedSource.match(EMAIL_REGEX) || []).map(normalizeEmail).filter(Boolean));

  const obfuscatedRegex =
    /\b([a-z0-9._%+-]+)\s+at\s+([a-z0-9-]+(?:\s+dot\s+[a-z0-9-]+)+)\b/gi;
  let match;
  while ((match = obfuscatedRegex.exec(source))) {
    const localPart = match[1];
    const domain = match[2].replace(/\s+dot\s+/gi, ".");
    const normalized = normalizeEmail(`${localPart}@${domain}`);
    if (normalized) {
      emails.add(normalized);
    }
  }

  return [...emails];
}

function extractXmlLocations(xml) {
  const matches = [];
  const locationRegex = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
  let match;
  while ((match = locationRegex.exec(String(xml || "")))) {
    const resolved = decodeHtmlEntities(match[1]);
    if (resolved) {
      matches.push(resolved.trim());
    }
  }
  return matches;
}

function looksLikeBlockedHtml(html) {
  const source = String(html || "").toLowerCase();
  return (
    source.includes("just a moment") ||
    source.includes("performing security verification") ||
    source.includes("verify you are not a bot") ||
    source.includes("security service to protect against malicious bots") ||
    source.includes("cf-browser-verification") ||
    source.includes("captcha")
  );
}

function ensureHtmlIsUsable(html, url, sourceName) {
  if (looksLikeBlockedHtml(html)) {
    throw new Error(`${sourceName} hit an anti-bot challenge for ${url}.`);
  }
}

function normalizeEmail(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^mail(?:to)?:/i, "")
    .replace(/[)>.,;:'"\]]+$/g, "")
    .toLowerCase();
  if (!normalized || !normalized.includes("@")) {
    return null;
  }
  const [localPart, domain] = normalized.split("@");
  if (!localPart || !domain || !domain.includes(".")) {
    return null;
  }
  const topLevelDomain = domain.split(".").pop();
  if (localPart === "-") {
    return null;
  }
  if (/^(example\.com|yourdomain\.com|domain\.com)$/i.test(domain)) {
    return null;
  }
  if (
    [...INVALID_EMAIL_TLDS].some(
      (candidate) => topLevelDomain === candidate || topLevelDomain.endsWith(candidate)
    )
  ) {
    return null;
  }
  if (PLACEHOLDER_EMAILS.has(normalized)) {
    return null;
  }
  return normalized;
}

function sortEmailsForSite(emails, website) {
  const rootHost = normalizeHost(new URL(website).hostname);
  return [...emails].sort((left, right) => {
    const leftScore = scoreEmail(left, rootHost);
    const rightScore = scoreEmail(right, rootHost);
    return rightScore - leftScore || left.localeCompare(right);
  });
}

function scoreEmail(email, rootHost) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return -1000;
  }

  const [, domain] = normalized.split("@");
  const normalizedDomain = normalizeHost(domain);
  let score = 0;

  if (normalizedDomain === rootHost) {
    score += 120;
  } else if (normalizedDomain.endsWith(`.${rootHost}`) || rootHost.endsWith(`.${normalizedDomain}`)) {
    score += 90;
  }

  if (THIRD_PARTY_EMAIL_DOMAINS.some((candidate) => normalizedDomain === candidate || normalizedDomain.endsWith(`.${candidate}`))) {
    score -= 80;
  }

  if (/^(info|contact|hello|office|admin|events|reservations?|catering)$/.test(normalized.split("@")[0])) {
    score += 10;
  }

  return score;
}

function detectSocialNetwork(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const [network, hosts] of SOCIAL_HOSTS) {
      if (hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) {
        return network;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function resolveUrl(value, baseUrl) {
  try {
    const resolved = new URL(value, baseUrl);
    if (!["http:", "https:"].includes(resolved.protocol)) {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

function scoreCandidateLink(url, anchorText, rootUrl, sourceUrl = null) {
  const target = `${url} ${anchorText || ""}`;
  let score = 0;
  if (CONTACT_LINK_HINT.test(target)) {
    score += 40;
    if (/contact/i.test(target)) {
      score += 40;
    }
    if (/(team|staff|about|story)/i.test(target)) {
      score += 25;
    }
  if (/(location|visit|find-us|hours)/i.test(target)) {
    score += 20;
  }
  if (/(cater|event|private|reservation)/i.test(target)) {
    score += 15;
  }
  if (/(press|media|news|journal|career|franchis)/i.test(target)) {
    score += 30;
  }
  }

  if (sourceUrl && isSameSite(url, rootUrl) && isHighSignalPage(sourceUrl)) {
    const childScore = scoreContextualChildLink(url, anchorText, sourceUrl);
    score = Math.max(score, childScore);
  }

  if (score > 0 && isSameSite(url, rootUrl)) {
    score += 10;
  }
  return score;
}

function scoreContextualChildLink(candidateUrl, anchorText, sourceUrl) {
  try {
    const sourcePath = new URL(sourceUrl).pathname.replace(/\/+$/, "");
    const candidatePath = new URL(candidateUrl).pathname.replace(/\/+$/, "");
    const target = `${candidateUrl} ${anchorText || ""}`;
    let score = 0;

    if (CONTEXTUAL_CHILD_PATH_HINT.test(target)) {
      score += 65;
    }
    if (
      sourcePath &&
      sourcePath !== "/" &&
      candidatePath.startsWith(`${sourcePath}/`) &&
      candidatePath !== sourcePath
    ) {
      score += 55;
    }
    if (
      anchorText &&
      anchorText.length <= 80 &&
      /^[a-z][a-z' -]{1,80}$/i.test(anchorText) &&
      anchorText.trim().split(/\s+/).length <= 5
    ) {
      score += 20;
    }
    return score;
  } catch {
    return 0;
  }
}

function isHighSignalPage(url) {
  try {
    return HIGH_SIGNAL_PAGE_HINT.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function isSameSite(candidateUrl, rootUrl) {
  try {
    const candidate = new URL(candidateUrl);
    const root = new URL(rootUrl);
    return normalizeHost(candidate.hostname) === normalizeHost(root.hostname);
  } catch {
    return false;
  }
}

function normalizeHost(host) {
  return String(host || "").trim().toLowerCase().replace(/^www\./, "");
}

function normalizeWebsiteUrl(value) {
  const trimmed = cleanString(value);
  if (!trimmed) {
    return null;
  }
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isAssetUrl(url) {
  return /\.(?:pdf|jpg|jpeg|png|gif|svg|webp|css|js|xml|zip|mp4|mp3)(?:[?#].*)?$/i.test(url);
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#x3A;/gi, ":")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

function cleanAnchorText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        break;
      }
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
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
  createEmailEnricher,
};
