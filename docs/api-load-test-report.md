# API Load Test Report — Care Circle (Local Pre-VPS)

**Date:** 2026-10-30  
**Tool:** autocannon v8.0.0 (devDependency)  
**Target:** Compiled API `node dist/server.js` — isolated `MongoMemoryServer`, test Firebase fixture SA  
**Environment:** `NODE_ENV=production`, `PROCESS_MODE=api`, `DELIVERY_MODE=fcm`

---

## Tests executed

| # | Scenario | Process | Result |
|---|----------|---------|--------|
| L1 | Health liveness burst | **dist/server.js** | **PASS** |
| L2 | 40× parallel authenticated prefs updates | In-process `createApp()` + auth mock + memory Mongo | **PASS** |

---

## L1 — Autocannon on `GET /health/live`

**Configuration**

| Parameter | Value |
|-----------|--------|
| Connections | 20 |
| Duration | 8 seconds |
| URL | `http://127.0.0.1:<dynamic>/health/live` |

**Sample run (full suite execution)**

| Metric | Value |
|--------|--------|
| Total requests | **~37,000** (37k in 8.02s on regression run) |
| Throughput | **~4,644 req/s** average (sampled) |
| Latency avg | **~3.8 ms** |
| Latency p99 | **~8 ms** (autocannon 99% column) |
| Latency max | **~23 ms** |
| Errors | **0** |
| Timeouts | **0** |
| non2xx | **0** |
| Process exit during test | **None** |

Earlier isolated run: ~29k requests / 8.03s (~3,568 req/s avg) — variance normal for local Windows host.

---

## L2 — Authenticated write concurrency (in-process)

| Metric | Value |
|--------|--------|
| Parallel requests | 40 |
| Endpoint | `PUT /v1/circles/load-c/members/me/prefs` |
| HTTP 200 | 40 / 40 |
| HTTP 4xx/5xx | 0 |
| Heap delta (parent test process) | < 80 MB (guardrail assertion) |

**Note:** Uses auth mock (same Express stack as production). Compiled child was **not** used for authenticated load because production process cannot inject test token verifier without staging Firebase.

---

## Not executed

| Scenario | Status | Reason |
|----------|--------|--------|
| High concurrency on reminder upserts via compiled server | **NOT TESTED** | Requires staging Firebase token verification or test hook in prod binary |
| Sustained 30+ minute soak | **NOT TESTED** | Bounded audit window; see memory doc for short soak |
| Load against shared/production MongoDB | **BLOCKED** | Safety boundary |

---

## HTTP error statistics (load tests)

| Code class | L1 | L2 |
|------------|----|----|
| 2xx | 100% | 100% |
| 4xx | 0 | 0 |
| 5xx | 0 | 0 |

---

## Classification

| Finding | Severity |
|---------|----------|
| Health endpoint stable under moderate burst | **LOW** risk for liveness probes |
| Authenticated writes stable at 40 parallel (mock auth) | **MEDIUM** confidence — **STAGING VERIFIED** still required under real tokens |

**Verdict:** **LOCAL RUNTIME VERIFIED** for health throughput; authenticated load **CODE VERIFIED** + limited **LOCAL RUNTIME VERIFIED** (in-process).
