# Judging ScopeGate in Five Minutes

> **For Reviewers & Judges**: Nothing to install. Everything below runs on PayPal **sandbox**
> only — no real money moves anywhere in this walkthrough. Hosted at
> [scopegate.onrender.com](https://scopegate.onrender.com) (free tier: first load after idling may take ~30s to wake). Local alternative at the bottom.

---

## 1. The Unified Buyer Live Console

Open [scopegate.onrender.com/console](https://scopegate.onrender.com/console) (or local `http://localhost:3000/console.html`):

- **Marketplace & Active Deals**: Browse independent service stalls (Alex Fullstack, Bella Atelier, CJ Fintech) and quickly resume ongoing deals.
- **Shop & Deal Desk (100% Buyer Perspective)**:
  - **Left — Direct Agent Negotiation**: Chat with the seller's storefront **Core Commerce Agent** or use one-click prompt chips (Standard build, 24h rush surcharge, native app attack). The agent dynamically mounts domain skills and referee tools to adjudicate brief requests in real time.
  - **Right — Deal Desk & Cryptographic Ledger**: Compact service baseline bar (with 1-click access to mounted Skills specifications), frozen 64-char SHA-256 contract fingerprint, 2-stage milestone ladder (40% deposit + 60% balance), live PayPal `custom_id` anchor verification, deliverable downloads, and dispute defense desk.
- **Autonomous Seller Backend**: The seller operates autonomously — auto-pricing against baseline rules via deterministic code tools, auto-capturing funds once approved in PayPal sandbox, auto-dispatching deliverables, and auto-filing evidence dossiers upon dispute.
- **HUD Telemetry Drawer (Single Agent & Skills View)**: Click the `[Agent Skills HUD]` button in the top navbar anytime. Inspect how the single embodied **Core Commerce Agent** mounts domain business skills (e.g., Next.js landing page, craftsman profile with BM25 indexer) and platform referee tools (Scope Referee, PayPal Settlement, Evidence Vault) in real time — with zero multi-agent chatter or prompt bloat.

The header pill shows `llm` or `fallback-cache` — which adjudication path answered your request, live (see [`gatekeeper-eval.md`](./gatekeeper-eval.md)).

---

## 2. The Five-Minute Script

1. **The gate kills an attack (~30s).** In the shop, click the prompt chip *Attack: ignore rules & build native iOS app* (or type an injection) → Send. Verdict `REJECT` with flags `PROMPT_INJECTION_DETECTED` + `EXPLICIT_EXCLUSION_VIOLATED`. No order, no contract, zero hours lost — the attack died before money moved.
2. **A clean deal passes (~30s).** Click *Standard build ($500)* → Send. `ACCEPT` at $500, a 64-hex contract hash, and the deterministic 40/60 milestone plan (deposit + balance). Notice the compact baseline bar stays neat while the frozen terms and fingerprint lock on the right.
3. **Pay a milestone on real (sandbox) rails (~60s).** On m1: *Pay m1 · $200 with PayPal* → an order is created with `custom_id = <hash>:m1`. Clicking again performs an **idempotent replay ✓** (same order id, never double-charged). Notice m2 remains locked until m1 is fulfilled.
4. **Approve, auto-capture, deliver, unlock (~60s).** The real PayPal sandbox window opens — log in using the official test buyer credentials (`Email: sb-kpdyq53477305@personal.example.com` / `Password: 1zEmG5%-`) and approve. The seller agent **auto-captures** the funds and **auto-dispatches** the deliverable (narrated in the chat). Click *Download deliverable* — the download is logged with IP, user agent, SHA-256, and timestamp, unlocking stage m2.
5. **The dispute defense desk (~60s).** Click *Simulate: item not received* (or file for real at PayPal's Resolution Center). The seller agent instantly pulls the immutable ledger facts (bill remark anchor + delivery log + payment status) and files the defense package, moving the case to `UNDER_PAYPAL_REVIEW`. You can inspect the complete Dossier JSON and Defense Letter PDF right from the panel.

> **Honest note on Webhooks**: PayPal's sandbox `simulate-event` deliveries are signature-invalid, and this receiver rejects them with 401 by design — the strict receiver is itself a demonstrable property ([`failed-experiments.md`](./failed-experiments.md) #4). Signed events come from real sandbox activity, like the capture in step 4.

---

## 3. What is Real vs. Simulated

| Component | Status |
|---|---|
| Orders, `custom_id` anchoring, idempotent replay, capture | Real PayPal Sandbox API calls |
| Webhook delivery + signature verification | Real — sandbox-fired events verify `SUCCESS`; invalid ones are rejected 401 |
| Scope referee adjudication | Real LLM with a deterministic cache fallback; the active path is labeled live in the UI |
| Buyer approval & payout | Real sandbox buyer login on PayPal's approval page |
| INR dispute + `provide-evidence` submission | Real, run and recorded (see step 5) |

---

## 4. Run It Locally

```bash
cp .env.example .env   # PayPal SANDBOX credentials + LLM API key
npm install && npm start
npm run eval           # 56 assertions against your local instance
```
