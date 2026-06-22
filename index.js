/**
 * index.js — Cloudflare Worker
 * ================================
 * Fetches ONLY the source HTML of the given answer-key URL (Part 1 / first section).
 * Returns the raw HTML to the browser. No parsing. No calculation. Nothing else.
 *
 * Features:
 *  - Real-time debug info: why fetch failed (IP block, bot detection, bad status, redirect, etc.)
 *  - Auto-retry with backoff if fetch fails (up to MAX_RETRIES attempts)
 *  - Returns raw HTML on success, or a JSON debug report on failure
 */

// ============================================================
// CONFIG
// ============================================================

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1200; // wait between retries

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en-IN;q=0.9,hi;q=0.8,en;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Cache-Control": "max-age=0",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ============================================================
// SLEEP HELPER
// ============================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// DEBUG ANALYZER
// Inspects response + error to give a real reason for failure
// ============================================================

function analyzeFailure(status, statusText, responseHeaders, html, networkError) {
  const debug = {
    status: status || null,
    statusText: statusText || null,
    reason: "unknown",
    detail: "",
    signals: [],
  };

  // Network-level error (DNS fail, connection refused, timeout)
  if (networkError) {
    const msg = networkError.message || String(networkError);
    debug.reason = "network_error";
    debug.detail = msg;

    if (/failed to fetch|network/i.test(msg)) debug.signals.push("possible_dns_or_routing_failure");
    if (/timeout/i.test(msg)) debug.signals.push("request_timed_out");
    if (/refused/i.test(msg)) debug.signals.push("connection_refused_by_server");
    return debug;
  }

  // HTTP status signals
  if (status === 403) {
    debug.reason = "ip_blocked_or_forbidden";
    debug.signals.push("http_403_forbidden");
    debug.detail = "Server returned 403 — your IP or Cloudflare Worker IP is blocked, or the request was flagged as a bot.";
  } else if (status === 429) {
    debug.reason = "rate_limited";
    debug.signals.push("http_429_too_many_requests");
    debug.detail = "Server returned 429 — too many requests from this IP. Rate limited.";
  } else if (status === 503 || status === 502) {
    debug.reason = "server_unavailable";
    debug.signals.push(`http_${status}`);
    debug.detail = "Server returned " + status + " — website may be down or blocking via WAF/CDN.";
  } else if (status === 302 || status === 301) {
    debug.reason = "redirected";
    const loc = responseHeaders?.get("location") || "unknown";
    debug.signals.push("redirect_detected");
    debug.detail = `Redirected to: ${loc}. Session may have expired or link is invalid.`;
  } else if (status >= 400) {
    debug.reason = "http_client_error";
    debug.detail = `HTTP ${status} ${statusText}`;
  } else if (status >= 500) {
    debug.reason = "http_server_error";
    debug.detail = `HTTP ${status} ${statusText}`;
  }

  // HTML body signals — detect bot detection pages, CAPTCHAs, login walls
  if (html) {
    const lower = html.toLowerCase();

    if (lower.includes("captcha")) {
      debug.signals.push("captcha_wall_detected");
      debug.reason = "bot_detection_captcha";
      debug.detail = "Response contains a CAPTCHA — bot/scraper detection triggered.";
    }
    if (lower.includes("access denied") || lower.includes("403 forbidden")) {
      debug.signals.push("access_denied_in_body");
      debug.reason = "ip_blocked_or_forbidden";
    }
    if (lower.includes("cloudflare") && lower.includes("ray id")) {
      debug.signals.push("cloudflare_challenge_page");
      debug.reason = "cloudflare_bot_protection";
      debug.detail = "Cloudflare challenge/block page detected. Worker IP may be on a blocklist.";
    }
    if (lower.includes("login") || lower.includes("sign in") || lower.includes("session expired")) {
      debug.signals.push("login_wall_or_session_expired");
      debug.reason = "session_required";
      debug.detail = "Response looks like a login page or session has expired. The URL may require an active session/cookie.";
    }
    if (lower.includes("invalid") && lower.includes("key")) {
      debug.signals.push("invalid_enckey_in_body");
      debug.reason = "invalid_url_or_key";
      debug.detail = "Response mentions invalid key — the enckey/EncKey in the URL may be wrong or expired.";
    }
    if (html.length < 200 && !debug.signals.length) {
      debug.signals.push("suspiciously_short_response");
      debug.detail = `Only ${html.length} bytes received — likely a block/redirect page, not real content.`;
    }
  }

  if (!debug.detail) {
    debug.detail = `HTTP ${status} — no specific block signal detected.`;
  }

  return debug;
}

// ============================================================
// FETCH WITH RETRY
// ============================================================

async function fetchWithRetry(url) {
  let lastError = null;
  const attempts = [];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const attemptLog = { attempt, url, timestamp: new Date().toISOString() };

    try {
      const resp = await fetch(url, {
        headers: BROWSER_HEADERS,
        redirect: "manual", // catch redirects manually so we can report them
      });

      const html = await resp.text();
      attemptLog.status = resp.status;
      attemptLog.statusText = resp.statusText;
      attemptLog.bytes = html.length;

      // Treat non-200 as failure (with full debug)
      if (resp.status !== 200) {
        const debug = analyzeFailure(resp.status, resp.statusText, resp.headers, html, null);
        attemptLog.result = "failed";
        attemptLog.debug = debug;
        attempts.push(attemptLog);

        // Don't retry on hard blocks (403, 302, 429 — retrying won't help)
        if ([403, 302, 301, 429].includes(resp.status)) {
          return { success: false, html: null, attempts, finalDebug: debug };
        }

        lastError = debug;
        if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }

      // Check if body looks like a real answer key page
      const debug = analyzeFailure(200, "OK", resp.headers, html, null);
      if (
        debug.signals.includes("captcha_wall_detected") ||
        debug.signals.includes("cloudflare_challenge_page") ||
        debug.signals.includes("login_wall_or_session_expired")
      ) {
        attemptLog.result = "soft_block";
        attemptLog.debug = debug;
        attempts.push(attemptLog);
        return { success: false, html: null, attempts, finalDebug: debug };
      }

      attemptLog.result = "success";
      attempts.push(attemptLog);
      return { success: true, html, attempts, finalDebug: null };

    } catch (err) {
      const debug = analyzeFailure(null, null, null, null, err);
      attemptLog.result = "network_error";
      attemptLog.debug = debug;
      attempts.push(attemptLog);
      lastError = debug;

      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  return { success: false, html: null, attempts, finalDebug: lastError };
}

// ============================================================
// REQUEST HANDLER
// GET /?url=<answer-key-url>
// Returns: raw HTML on success, JSON debug report on failure
// ============================================================

export default {
  async fetch(request) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const reqUrl = new URL(request.url);
    const targetUrl = reqUrl.searchParams.get("url");

    if (!targetUrl) {
      return new Response(
        JSON.stringify({
          error: "Missing ?url= parameter. Pass the answer-key URL as ?url=...",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        }
      );
    }

    // Basic URL sanity check
    let parsedTarget;
    try {
      parsedTarget = new URL(targetUrl);
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid URL provided in ?url= parameter." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        }
      );
    }

    // Fetch (with retry + debug)
    const { success, html, attempts, finalDebug } = await fetchWithRetry(targetUrl);

    if (success) {
      // Return raw HTML — nothing else
      return new Response(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          ...CORS_HEADERS,
        },
      });
    }

    // Failure — return structured debug JSON
    return new Response(
      JSON.stringify({
        error: "Failed to fetch source HTML after retries.",
        target_url: targetUrl,
        total_attempts: attempts.length,
        final_reason: finalDebug?.reason || "unknown",
        final_detail: finalDebug?.detail || "",
        signals: finalDebug?.signals || [],
        attempts, // full per-attempt log
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }
    );
  },
};
