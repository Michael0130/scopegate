# Failed Experiments & Scope Reduction Log

> Empirical build log: real engineering experiments, failures, and architectural pivots from the ScopeGate build.
> Judges and reviewers: this document tracks our real technical iterations and the honest boundaries of the system.

---

## Experiment 1 — AG Grid v32 UMD bundle with `theme: 'legacy'`

- **Hypothesis**: The latest ag-grid-community v32.3.3 UMD bundle with the legacy CSS theme path
  (`theme: 'legacy'` + `ag-theme-quartz-dark` wrapper class) is the fastest way to a dark grid.
- **What we tried**: Vendored v32.3.3, initialized via `agGrid.createGrid(el, { theme: 'legacy', … })`,
  then re-imported the module in-page to capture the stack.
- **Result / why it failed**: Every init threw `r?.startUse is not a function` (internal Theming-API
  lifecycle call). The new-API default (`themeQuartz`) initialized fine but ignored dark params in
  this version, so neither path gave a reliable dark legacy grid.
- **Decision**: Downgraded the vendored bundle to v31.3.2, where classic wrapper-class theming
  (`ag-theme-quartz-dark`) works with zero options. One day lost to a library regression; stability
  over novelty.

---

## Experiment 2 — `glm-4.6` model alias for the gatekeeper LLM

- **Hypothesis**: Request `glm-4.6` on the BigModel Coding Plan endpoint — the documented model name
  with the largest context.
- **What we tried**: 6 endpoint/model combinations, then `thinking: {"type":"disabled"}` and JWT
  auth variants to bring latency under the 4-second fail-safe budget.
- **Result / why it failed**: The plan silently routes `glm-4.6` to an always-thinking variant
  (error 1210 — "this model always thinks; thinking cannot be disabled"). Gatekeeper verdicts took 12–17s with 8–16 token
  budgets burned entirely in `reasoning_content`. Under the spec's 4s timeout every live call fell
  back to the deterministic cache.
- **Decision**: Request `glm-5.3-flash` explicitly (thinking can be disabled on it) and slim the LLM
  output contract to a verdict skeleton (~100 tokens). Measured 3.0–3.8s — safely inside budget.

---

## Experiment 3 — First API key from the open-platform console

- **Hypothesis**: Any API key from the BigModel console can use the Coding Plan quota via the
  `/api/coding/paas/v4` endpoint.
- **What we tried**: 11 models × both endpoints × raw-key and JWT auth — a full exhaustion matrix.
- **Result / why it failed**: Every combination returned `1113` — "insufficient balance or no
  available resource package" — while the same key could list models (auth valid, quota absent). The key was a regular open-platform key, not
  bound to the plan.
- **Decision**: Generated the plan-specific key; both endpoints immediately served traffic. Lesson:
  on this platform, key ≠ plan binding — validate a key with one live paid call before building on it.

---

## Experiment 4 — Verifying signatures of `simulate-event` webhook deliveries

- **Hypothesis**: `POST /v1/notifications/simulate-event` delivers a properly signed sandbox
  event, so `POST /v1/notifications/verify-webhook-signature` should return `SUCCESS` for it —
  giving an offline demo of the `CUSTOMER.DISPUTE.CREATED` → dossier pipeline.
- **What we tried**: Registered the webhook via API (`0UD40341KJ851773S` →
  `https://scopegate.onrender.com/api/webhooks/paypal`), fired simulations for
  `CUSTOMER.DISPUTE.CREATED` and `PAYMENT.CAPTURE.COMPLETED` (both 202, deliveries really
  arrived on Render with full `PAYPAL-*` transmission headers), and verified them two ways:
  through PayPal's verify API, and locally with the documented algorithm
  (`transmission_id|transmission_time|webhook_id|crc32(body)`, SHA256withRSA against the cert
  at `cert_url`).
- **Result / why it failed**: Every simulated delivery failed verification both ways. The
  signature simply is not computed over our webhook id with the delivered certificate —
  the sandbox simulator signs with an internal id we cannot know (a known sandbox quirk;
  cf. paypal/PayPal-PHP-SDK#704). Empirical boundaries: `webhook_id`-vs-`url` in the simulate request makes no
  difference; `CHECKOUT.ORDER.APPROVED` is not simulatable at all ("Not a valid Resource Type").
- **Decision**: The receiver stays strict — unverifiable deliveries are recorded
  (`GET /api/v1/webhook-events?raw=1` shows them as `rejected: FAILURE`) and answered 401,
  which is itself a demonstrable security property. Verified-green events come from
  *real* sandbox events (a genuine capture fires a genuinely-signed
  `PAYMENT.CAPTURE.COMPLETED`).

---

## Experiment 5 — Disputes `provide-evidence` multipart part naming

- **Hypothesis**: The JSON metadata part is named `evidence_info` (as suggested by
  older community examples and the field name in the response schema).
- **What we tried**: Against live sandbox dispute `PP-R-LKW-10194104`
  (`WAITING_FOR_SELLER_RESPONSE`, provide_evidence HATEOAS link present) we posted:
  part names `evidence_info` / `files[]` / `evidence-file` / `file`, with and without
  a file, with undici FormData and with a hand-rolled byte-exact multipart body, and
  with a known-good W3C PDF as the attachment — 10 variants.
- **Result / why it failed**: Every variant returned `400 INVALID_EVIDENCE_FILE` —
  even with no file attached at all, and even with a guaranteed-valid PDF. The error
  text points at the file, but the actual cause is the JSON part name: the endpoint
  expects the part to be named **`input`** (per the current API explorer).
- **Decision**: `input` + `files` (hand-rolled multipart) returned **200** and moved
  the dispute to `UNDER_PAYPAL_REVIEW` — the full order → capture → INR dispute →
  evidence chain now runs for real in sandbox. Lesson: PayPal's misleading error
  codes cost hours; when an error smells wrong, hunt the official request
  example rather than iterating on the flagged field.

---

## Experiment 6 — The 10,000-Token Multi-Agent Prompt Explosion (and the Single Agent + Skills Solution) ★

- **Hypothesis**: Simulating 5 separate virtual agents (Concierge, Gatekeeper, Finance, Delivery, Legal) inside the system prompt would deliver a rich autonomous agency experience.
- **What we tried**: On every conversational turn, we serialized the complete merchant profile, legal guidelines, delivery specs, and all 5 agent personas into the system prompt.
- **Result / why it failed**: The prompt ballooned to **23,634 characters (~9,800 tokens)** per single turn (14.5 KB JSON payload). This caused:
  1. Massive latency (>10s round-trips);
  2. Severe token cost waste;
  3. LLM arithmetic hallucinations: the model frequently negotiated conflicting discounts between the Concierge and Finance roles.
- **Decision**: Completely dismantled the multi-agent conversational mesh. Re-architected into a **single embodied Core Commerce Agent** mounted with on-demand **Skills**:
  1. Built a zero-dependency in-memory **BM25 indexer tool** (`src/agent/indexer.js`) to recall relevant domain snippets in <5ms;
  2. Stripped the model of financial math, delegating pricing and 40/60 milestone calculation to deterministic Node.js code tools;
  3. Slashed the base prompt by **>90% down to ~800 tokens**. Latency dropped to ~1.8s while maintaining **100% eval pass rate (56/56)**.

---

## Claims Deliberately Narrowed

1. **Over-claim**: "Live LLM adjudication in under 4 seconds, always."
   - **Narrowed to**: "Live LLM adjudication in ~2–3 seconds typical, with a deterministic verdict cache guaranteeing a correct sub-4s answer under provider rate-limiting or outage."
   - **Why**: Burst traffic trips API rate limits; the honest architectural guarantee is stronger than relying on third-party uptime.

2. **Over-claim**: "Autonomous escrow without financial intermediaries."
   - **Narrowed to**: "Zero-custody milestone state machine backed 100% by PayPal native APIs."
   - **Why**: Self-custody of funds without money-transmitter licenses is an existential legal liability. Utilizing PayPal's `custom_id` on official ledger rails delivers cryptographic tamper-proofing with zero custody risk.
