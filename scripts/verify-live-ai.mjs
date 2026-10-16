#!/usr/bin/env node

/**
 * Opt-in end-to-end check for the configured Vertex ADC backend.
 * Makes one general agent request and one Google Search-grounded policy request
 * through the running app. These are real, potentially billable API calls.
 */

import { randomUUID } from "node:crypto";

const baseUrl = new URL(process.env.LIVE_AI_BASE_URL ?? "http://localhost:3000");
const timeoutMs = positiveInteger(process.env.LIVE_AI_TIMEOUT_MS, 180_000);
const results = [];

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeError(value) {
  return String(value)
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/(api[_ -]?key|access[_ -]?token|authorization)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[redacted]")
    .replace(/https?:\/\/[^\s/]+\/v1\/projects\/[^/]+/gi, "[Vertex endpoint]")
    .slice(0, 400);
}

async function fetchJson(path, options = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...options,
    headers: { Accept: "application/json", ...options.headers },
    signal: options.signal ?? AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}${body?.error ? `: ${safeError(body.error)}` : ""}`);
  }
  return body;
}

function parseSseFrame(frame, events) {
  for (const line of frame.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      throw new Error("The app returned an invalid server-sent event.");
    }
  }
}

async function readSse(response) {
  if (!response.body) throw new Error("The chat API returned no response stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) parseSseFrame(frame, events);
  }
  buffer += decoder.decode();
  if (buffer.trim()) parseSseFrame(buffer, events);
  return events;
}

async function runProbe(label, message, validate) {
  const sessionId = `live_ai_verify_${randomUUID().replaceAll("-", "")}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  let failure = null;
  try {
    const response = await fetch(new URL("/api/agent/chat", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ sessionId, message }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Chat API returned HTTP ${response.status}.`);
    const events = await readSse(response);
    const providerErrors = events.filter((event) => event.type === "error");
    if (providerErrors.length) {
      throw new Error(`Agent emitted an error event: ${safeError(providerErrors[0].message ?? "unknown error")}`);
    }
    const text = events
      .filter((event) => event.type === "assistant_text")
      .map((event) => String(event.text ?? ""))
      .join(" ");
    if (/Demo mode\s*[—-]\s*no model provider configured/i.test(text)) {
      throw new Error("The agent answered in demo mode instead of using Vertex AI.");
    }
    const detail = validate(events, text);
    results.push({ label, ok: true, durationMs: Date.now() - startedAt, detail });
  } catch (error) {
    const reason = controller.signal.aborted
      ? `Timed out after ${timeoutMs} ms.`
      : safeError(error instanceof Error ? error.message : error);
    failure = new Error(reason);
    results.push({ label, ok: false, durationMs: Date.now() - startedAt, detail: reason });
  } finally {
    clearTimeout(timer);
    try {
      await fetch(new URL(`/api/agent/chat?sessionId=${encodeURIComponent(sessionId)}`, baseUrl), {
        method: "DELETE",
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // The temporary in-memory task expires with the server process if cleanup fails.
    }
  }
  return failure === null;
}

const officialSuffixes = [
  ".gov", ".gov.uk", ".gov.au", ".gov.bd", ".gov.ca", ".gov.ie", ".gov.in",
  ".edu", ".edu.au", ".edu.bd", ".edu.in", ".edu.sg", ".edu.my", ".edu.pk",
  ".ac.uk", ".ac.nz", ".ac.au", ".ac.bd", ".ac.in", ".ac.jp", ".ac.kr", ".ac.za",
];

function isOfficialUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return url.protocol === "https:" && officialSuffixes.some((suffix) => host.endsWith(suffix));
  } catch {
    return false;
  }
}

function validateFinance(events, text) {
  const hasUnderstanding = events.some((event) => event.type === "status" && event.phase === "understanding");
  const hasReply = Boolean(text.trim()) || events.some((event) => event.type === "clarify");
  if (!hasUnderstanding || !hasReply) {
    throw new Error("No complete model-driven finance response was returned.");
  }
  return "Vertex returned a student-finance response or clarification.";
}

function validateResearch(events) {
  const result = events.find((event) => event.type === "result" && event.component === "policy_research");
  if (!result || typeof result.data !== "object" || result.data === null) {
    throw new Error("The agent did not return a policy-research result.");
  }
  const data = result.data;
  const sources = Array.isArray(data.sources) ? data.sources : [];
  const searchQueries = Array.isArray(data.webSearchQueries) ? data.webSearchQueries : [];
  const claims = Array.isArray(data.supportedClaims) ? data.supportedClaims : [];
  const checkedAt = typeof data.checkedAt === "string" ? Date.parse(data.checkedAt) : NaN;
  const recentCheck = Number.isFinite(checkedAt) && checkedAt <= Date.now() + 60_000 && Date.now() - checkedAt <= 10 * 60_000;
  const secureOfficialSources = sources.filter((source) => source && isOfficialUrl(source.uri));
  const groundedClaims = claims.filter((claim) =>
    claim && typeof claim.text === "string" && claim.text.trim() &&
    Array.isArray(claim.sources) && claim.sources.some((source) => source && isOfficialUrl(source.uri)),
  );
  if (data.needsClarification === true) {
    const missing = Array.isArray(data.missing) ? data.missing.filter((item) => typeof item === "string") : [];
    throw new Error(`Agent requested clarification before Google Search grounding${missing.length ? `; missing: ${missing.join(", ")}` : ""}.`);
  }
  if (typeof data.answer !== "string" || !data.answer.trim()) {
    throw new Error(
      `${safeError(data.note ?? "No policy answer was returned.")} Search queries reported: ${searchQueries.length}; verified pages: ${sources.length}.`,
    );
  }
  if (!recentCheck || secureOfficialSources.length === 0 || secureOfficialSources.length !== sources.length || groundedClaims.length === 0) {
    throw new Error("The policy result lacked a recent checked-at time, official HTTPS citations, or claims linked to those sources.");
  }
  return `${secureOfficialSources.length} official HTTPS source(s), ${groundedClaims.length} cited claim(s), checked ${new Date(checkedAt).toISOString()}.`;
}

async function main() {
  console.log(`Live AI verification · ${baseUrl.origin}`);
  console.log("This makes real Vertex AI and Google Search grounding requests; usage may be billed to your Cloud project.\n");

  let status;
  try {
    status = await fetchJson("/api/agent/status");
  } catch (error) {
    console.error(`[FAIL] App status: ${safeError(error instanceof Error ? error.message : error)}`);
    process.exitCode = 1;
    return;
  }
  if (status.provider !== "vertex" || status.configured !== true) {
    console.error(`[FAIL] Vertex is not selected/configured (provider: ${status.provider ?? "unknown"}). Start the app with AI_BACKEND=vertex-adc and valid ADC settings.`);
    process.exitCode = 1;
    return;
  }
  console.log(`[PASS] Provider selection: ${status.label ?? "Google Vertex AI"}`);

  const skipFinance = process.env.LIVE_AI_SKIP_FINANCE === "1";
  const financeOk = skipFinance || await runProbe(
    "Student-finance agent",
    "I am preparing to study abroad and want to understand whether I can afford tuition and living costs. What details should you ask me for before making a plan? Do not estimate any amounts.",
    validateFinance,
  );
  if (skipFinance) console.log("[SKIP] Student-finance agent probe skipped by LIVE_AI_SKIP_FINANCE=1.");
  const researchOk = await runProbe(
    "Google Search policy grounding",
    "For this live integration check, use the research_policy tool to find the current official proof-of-funds policy for international students applying for an Australian Student visa (subclass 500). Cite the official government pages supporting each claim, and say if current terms cannot be verified.\nTopic: proof_of_funds\nCountry: Australia",
    validateResearch,
  );

  for (const result of results) {
    console.log(`[${result.ok ? "PASS" : "FAIL"}] ${result.label} (${(result.durationMs / 1000).toFixed(1)}s): ${result.detail}`);
  }
  if (!financeOk || !researchOk) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[FAIL] Live verification stopped: ${safeError(error instanceof Error ? error.message : error)}`);
  process.exitCode = 1;
});
