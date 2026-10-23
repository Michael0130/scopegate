# ScopeGate

> **The scope firewall for agentic commerce.**

ScopeGate is a **merchant-side AI admission gateway** for bespoke digital services (custom development, UI design, technical consulting). It lets independent sellers safely sell to external AI buyer agents by adjudicating every incoming request against the merchant's explicit service baseline **before** any PayPal order is created — and by generating cryptographically anchored evidence when a buyer files a malicious "item not received" dispute.

## Why

Agentic commerce arms buyers with tireless agents that negotiate relentlessly, creep scope, and inject instructions to extract unpaid work. Meanwhile the dispute infrastructure (chargebacks, "no tracking number" rejections) puts intangible-goods sellers on the losing side of every conflict. ScopeGate flips the defaults back toward the **seller**:

1. **Gatekeeper (before the order)** — buyer input is isolated in XML tags to neutralize prompt injection, then matched against `schemas/service.schema.json`. Pricing follows a **one-way ratchet** (add-ons may only raise the quote). Verdicts are discrete: `ACCEPT`, `COUNTER` (re-quote with locked revision rounds), or `REJECT` (exclusion/blacklist hit or injection detected).
2. **Hash Anchor (at the order)** — the agreed contract JSON is SHA-256 hashed and written into the PayPal order as `purchase_units[0].custom_id`, an immutable anchor in PayPal's own ledger. Orders are intangible-service (`shipping_preference: NO_SHIPPING`) and idempotent via the `PayPal-Request-Id` header, so agent retries can never double-charge.
3. **Evidence Dossier (after delivery)** — the delivery gateway records the payer-verified email dispatch, access IP, user agent, timestamps, and artifact SHA-256, then exports a one-click dispute package aligned with PayPal Seller Protection Intangible Goods Additional Requirements.

## Quick start

```bash
cp .env.example .env    # fill in PayPal SANDBOX credentials (sandbox only — never live keys)
npm install
npm start               # http://localhost:3000
```

Validate the PayPal sandbox plumbing end-to-end (OAuth2 → order with contract-hash `custom_id` → idempotent replay):

```bash
npm run spike
```

## Evaluation suite

`test/eval-cases.json` contains the 6 canonical adjudication cases: prompt injection + exclusion violation, blacklist violation, rush surcharge re-quote, clean baseline acceptance, subjective-scope de-scoping, and idempotent replay.

## Project structure

```text
schemas/    service baseline, decision output, dispute dossier contracts
spikes/     P0 single-point validation scripts (PayPal sandbox)
src/gate/   Gatekeeper: prompt firewall + scope matcher
src/paypal/ PayPal sandbox client (Orders v2, Capture, Disputes)
src/delivery/ delivery access tracking for the evidence dossier
public/     two-pane demo UI (buyer simulator | merchant console)
test/       eval cases for the gatekeeper
docs/       evidence table + failed experiments log
```

## License

[MIT](LICENSE)
