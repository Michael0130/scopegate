# Failed Experiments & Scope Reduction Log

> W2-D5 deliverable (Master Spec §8, D5): 3 failed experiments and one deliberately narrowed
> over-claim. All entries below are real experiments from the D1–D4 build log (2026-10-21/22),
> plus one from the phase-2 webhook integration (2026-10-22).

## Experiment 1 — AG Grid v32 UMD bundle with `theme: 'legacy'`

- **Hypothesis**: the latest ag-grid-community v32.3.3 UMD bundle with the legacy CSS theme path
  (`theme: 'legacy'` + `ag-theme-quartz-dark` wrapper class) is the fastest way to a dark grid.
- **What we tried**: vendored v32.3.3, initialized via `agGrid.createGrid(el, { theme: 'legacy', … })`,
  then re-imported the module in-page to capture the stack.
- **Result / why it failed**: every init threw `r?.startUse is not a function` (internal Theming-API
  lifecycle call). The new-API default (`themeQuartz`) initialized fine but ignored dark params in
  this version, so neither path gave a reliable dark legacy grid.
- **Decision**: downgraded the vendored bundle to v31.3.2, where the classic wrapper-class theming
  (`ag-theme-quartz-dark`) works with zero options. One day lost to a library regression; stability
  over novelty.

## Experiment 2 — `glm-4.6` model alias for the gatekeeper LLM

- **Hypothesis**: request `glm-4.6` on the BigModel Coding Plan endpoint — the documented model name
  with the largest context.
- **What we tried**: 6 endpoint/model combinations, then `thinking: {"type":"disabled"}` and JWT
  auth variants to bring latency under the 4-second fail-safe budget.
- **Result / why it failed**: the plan silently routes `glm-4.6` to an always-thinking variant
  (error 1210: "该模型始终思考，不支持关闭思考"). Gatekeeper verdicts took 12–17s with 8–16 token
  budgets burned entirely in `reasoning_content`. Under the spec's 4s timeout every live call fell
  back to the deterministic cache.
- **Decision**: request `glm-5.3-flash` explicitly (thinking can be disabled on it) and slim the LLM
  output contract to a verdict skeleton (~100 tokens). Measured 3.0–3.8s — inside budget.

## Experiment 3 — first API key from the open-platform console

- **Hypothesis**: any API key from the BigModel console can use the Coding Plan quota via the
  `/api/coding/paas/v4` endpoint.
- **What we tried**: 11 models × both endpoints × raw-key and JWT auth — a full exhaustion matrix.
- **Result / why it failed**: every combination returned `1113 余额不足或无可用资源包` while the same
  key could list models (auth valid, quota absent). The key was a regular open-platform key, not
  bound to the plan.
- **Decision**: generated the plan-specific key; both endpoints immediately served traffic. Lesson:
  on this platform, key ≠ plan binding — validate a key with one paid call before building on it.

## Experiment 4 — verifying signatures of `simulate-event` webhook deliveries

- **Hypothesis**: `POST /v1/notifications/simulate-event` delivers a properly signed sandbox
  event, so `POST /v1/notifications/verify-webhook-signature` should return `SUCCESS` for it —
  giving an offline demo of the `CUSTOMER.DISPUTE.CREATED` → dossier pipeline.
- **What we tried**: registered the webhook via API (`0UD40341KJ851773S` →
  `https://scopegate.onrender.com/api/webhooks/paypal`), fired simulations for
  `CUSTOMER.DISPUTE.CREATED` and `PAYMENT.CAPTURE.COMPLETED` (both 202, deliveries really
  arrived on Render with full `PAYPAL-*` transmission headers), and verified them two ways:
  through PayPal's verify API, and locally with the documented algorithm
  (`transmission_id|transmission_time|webhook_id|crc32(body)`, SHA256withRSA against the cert
  at `cert_url` — including a brute matrix over serialization/format variants).
- **Result / why it failed**: every simulated delivery failed verification both ways. The
  signature simply is not computed over our webhook id with the delivered certificate —
  the sandbox simulator signs with an internal id we cannot know (a known sandbox quirk;
  cf. paypal/PayPal-PHP-SDK#704, where sandbox verifications consistently fail even over
  ngrok). Empirical boundaries: `webhook_id`-vs-`url` in the simulate request makes no
  difference; `CHECKOUT.ORDER.APPROVED` is not simulatable at all ("Not a valid Resource
  Type").
- **Decision**: the receiver stays strict — unverifiable deliveries are recorded
  (`GET /api/v1/webhook-events?raw=1` shows them as `rejected: FAILURE`) and answered 401,
  which is itself a demonstrable security property. Verified-green events will come from
  *real* sandbox events (a genuine capture fires a genuinely-signed
  `PAYMENT.CAPTURE.COMPLETED`).

## Experiment 5 — Disputes `provide-evidence` multipart part naming

- **Hypothesis**: the JSON metadata part is named `evidence_info` (as suggested by
  older community examples and the field name in the response schema).
- **What we tried**: against live sandbox dispute `PP-R-LKW-10194104`
  (`WAITING_FOR_SELLER_RESPONSE`, provide_evidence HATEOAS link present) we posted:
  part names `evidence_info` / `files[]` / `evidence-file` / `file`, with and without
  a file, with undici FormData and with a hand-rolled byte-exact multipart body, and
  with a known-good W3C PDF as the attachment — 10 variants.
- **Result / why it failed**: every variant returned `400 INVALID_EVIDENCE_FILE` —
  even with no file attached at all, and even with a guaranteed-valid PDF. The error
  text points at the file, but the actual cause is the JSON part name: the endpoint
  expects the part to be named **`input`** (per the current API explorer).
- **Decision**: `input` + `files` (hand-rolled multipart) returned **200** and moved
  the dispute to `UNDER_PAYPAL_REVIEW` — the full order → capture → INR dispute →
  evidence chain now runs for real in sandbox. Lesson: PayPal's misleading error
  codes here cost an hour; when an error smells wrong, hunt the official request
  example rather than iterating on the flagged field.

## Claim deliberately narrowed

- **Over-claim**: "live LLM adjudication in under 4 seconds, always."
- **Narrowed to**: "live LLM adjudication in ~3 seconds typical, with a deterministic verdict cache
  guaranteeing a correct sub-4s answer under provider rate-limiting or outage" (observed during
  testing: burst traffic trips the plan's rate limiter and the fallback path answers instead).
- **Why**: the honest version is stronger — the guarantee comes from the architecture, not the
  provider's mood.
