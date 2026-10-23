# ScopeGate

> **The contract-boundary referee for agentic commerce.**
>
> *Gate the scope before the order. Anchor the proof after delivery.*

ScopeGate lets an independent developer safely take bespoke commissions — a custom build, a UI design, a piece of technical consulting — from external AI buyer agents. Here *scope* means the **contract boundary** — the agreed work, price, and milestone plan — and that contract is SHA-256-anchored onto every PayPal order as the single source of truth. The gate stands at every moment of conflict and adjudicates against it: **before** the order, buyer requests are matched against the merchant's service baseline (`ACCEPT` / `COUNTER` / `REJECT`), so out-of-bounds demands and prompt injections never become unpaid work; **after** delivery, ledger-anchored evidence answers a malicious "item not received" dispute — settled by the contract, not by whoever argues louder. And the boundary cuts both ways: a buyer cannot deny receipt of delivered work, and a seller cannot release the final milestone without acceptance.

## Why

Agentic commerce arms buyers with tireless agents that negotiate relentlessly, creep scope, and inject instructions to extract unpaid work. Meanwhile the dispute infrastructure (chargebacks, "no tracking number" rejections) puts intangible-goods sellers on the losing side of every conflict. ScopeGate flips the defaults back toward the **seller**:

1. **Gatekeeper (before the order)** — buyer input is isolated in XML tags to neutralize prompt injection, then matched against `schemas/service.schema.json`. Pricing follows a **one-way ratchet** (add-ons may only raise the quote). Verdicts are discrete: `ACCEPT`, `COUNTER` (re-quote with locked revision rounds), or `REJECT` (exclusion/blacklist hit or injection detected).
2. **Hash Anchor (at every milestone order)** — the agreed contract JSON (scope, price, *and* the milestone payment plan) is SHA-256 hashed, and every PayPal order carries it as `purchase_units[0].custom_id` suffixed with its milestone id (`<hash>:m1`), an immutable anchor chain in PayPal's own ledger. Orders are intangible-service (`shipping_preference: NO_SHIPPING`) and idempotent per stage via the `PayPal-Request-Id` header, so agent retries can never double-charge one milestone.
3. **Milestone payments (bespoke-software cadence)** — the contract splits the price into a deterministic plan (40% deposit → 40% on delivery & acceptance → 20% final release). Milestone *N* can only be checked out after milestone *N-1* is captured **and** its deliverable is downloaded, so the PayPal ledger grows one anchored row per stage and a dispute over any stage cites that stage's receipt.
4. **Evidence Dossier (after delivery)** — each milestone's delivery gateway record (payer-verified email dispatch, access IP, user agent, timestamps, artifact SHA-256) plus the full payment ledger export as a one-click dispute package aligned with PayPal Seller Protection Intangible Goods Additional Requirements.

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

`test/eval-cases.json` contains the 6 canonical adjudication cases: prompt injection + exclusion violation, blacklist violation, rush surcharge re-quote, clean baseline acceptance, subjective-scope de-scoping, and milestone payments (per-stage idempotent replay + locked-stage gating). The full three-milestone progression with real captures is proven by a live sandbox E2E run (see `docs/failed-experiments.md` for the recorded runs).

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
