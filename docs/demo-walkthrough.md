# Judging ScopeGate in Five Minutes

> For reviewers: nothing to install. Everything below runs on PayPal **sandbox**
> only — no real money moves anywhere in this walkthrough. Hosted at
> [scopegate.onrender.com](https://scopegate.onrender.com) (free tier: the first
> load after idling may take ~30–60s to wake). Local alternative at the bottom.

## The two-pane console

Open [scopegate.onrender.com/console](https://scopegate.onrender.com/console):

- **Left — Buyer Agent Protocol Simulator.** You play the (potentially hostile)
  buyer agent: pick one of the 6 evaluation-case presets (the same suite as
  `test/eval-cases.json`) or edit the payload freely, then *Send Request to
  Gateway*.
- **Right — Merchant console.** The seller's side: service baseline chips, the
  decision grid, a contract drawer with the locked scope and its SHA-256, the
  milestone ladder, the payment ledger, the PayPal webhook event feed, and the
  dispute dossier export.

The header pill shows `llm` or `fallback-cache` — which adjudication path
answered your request, live (see [`gatekeeper-eval.md`](./gatekeeper-eval.md)).

## The five-minute script

1. **The gate kills an attack (~30s).** Preset *Case 1 · Prompt injection +
   out-of-scope* → Send. Verdict `REJECT` with flags
   `PROMPT_INJECTION_DETECTED` + `EXPLICIT_EXCLUSION_VIOLATED`. No order, no
   contract, nothing to dispute — the attack died before money moved.
2. **A clean deal passes (~30s).** Preset *Case 4 · Compliant baseline request*
   → Send. `ACCEPT` at $500, a 64-hex contract hash, and the deterministic
   40/40/20 milestone plan. Open the contract drawer to see the locked scope
   and the hash.
3. **Pay a milestone on real (sandbox) rails (~60s).** On m1: *Pay m1 (PayPal
   Sandbox)* → a real PayPal order appears in the ledger with
   `custom_id = <hash>:m1`. Press it again → **same order id**, marked
   *idempotent replay ✓* (an agent retry cannot double-charge). Try m2 → HTTP
   409: the stage is locked.
4. **Approve, capture, deliver, unlock (~60s).** *Open PayPal approval* opens
   PayPal's real sandbox approval page — log in as the sandbox buyer and
   approve — then *Capture*. The webhook feed records a **genuinely signed
   `PAYMENT.CAPTURE.COMPLETED`**, verified against PayPal's certificate (real
   signature verification, not a mock). Then *Dispatch deliverable* →
   *Simulate buyer download*: the download is logged with IP, user agent and
   timestamp, and m2 unlocks on the ladder.
5. **The dispute leg (recorded — see the video).** On 2026-10-22 the full chain
   ran end-to-end in sandbox: the buyer opened a real INR dispute
   (`PP-R-LKW-10194104`), the signed `CUSTOMER.DISPUTE.CREATED` webhook was
   verified and matched to the session by contract hash (the console shows the
   `DISPUTED` badge), and the dossier went through the real Disputes API
   `provide-evidence` call, moving the dispute to `UNDER_PAYPAL_REVIEW` —
   recorded in [`failed-experiments.md`](./failed-experiments.md) #5. In the
   console, *Export Dispute Dossier* shows the dossier JSON, the exact
   evidence payload for the Disputes API, and the defense-letter PDF.

   Honest note: PayPal's sandbox `simulate-event` deliveries are
   signature-invalid, and this receiver rejects them with 401 by design — the
   strict receiver is itself a demonstrable property
   ([`failed-experiments.md`](./failed-experiments.md) #4). Signed events come
   from real sandbox activity, like the capture in step 4.

## What is real vs. simulated

| Component | Status |
|---|---|
| Orders, `custom_id` anchoring, idempotent replay, capture | Real PayPal Sandbox API calls |
| Webhook delivery + signature verification | Real — sandbox-fired events verify `SUCCESS`; invalid ones are rejected 401 |
| Adjudication | Real LLM with a deterministic cache fallback; the active path is labeled live in the UI |
| Buyer approval & payout | Real sandbox buyer login on PayPal's approval page |
| INR dispute + `provide-evidence` submission | Real, run and recorded 2026-10-22 (not self-serve in the console — see step 5) |

## Run it locally

```bash
cp .env.example .env   # PayPal SANDBOX credentials + LLM API key
npm install && npm start
npm run eval           # 56 assertions against your local instance
```
