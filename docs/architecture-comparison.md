# Old World vs. ScopeGate: Where the Architecture Actually Changes

> Advisor-directed framing (2026-10-23): show the delta, not the whole system.
> Read this side-by-side with `docs/painpoint-verification.md` — every annotated
> difference below is tied to a verified pain point.

## The old world: four disconnected artifacts

```mermaid
flowchart LR
    subgraph OLD["Today — bespoke digital services"]
        A1["Chat / DM<br/>(scope agreed verbally)"] --> A2["PayPal order<br/>(amount only —<br/>no scope on the ledger)"]
        A2 --> A3["Delivery via email /<br/>Figma link / Drive"]
        A3 --> A4["Dispute day:<br/>seller assembles screenshots,<br/>prays reviewer accepts them"]
    end
    A1 -. "❌ nothing links the words<br/>to the payment" .- A2
    A2 -. "❌ no fulfillment record<br/>tied to the payer" .- A3
    A3 -. "❌ evidence is reconstructed<br/>after the fact" .- A4
```

The scope, the payment, the delivery, and the evidence live in four different systems
owned by four different parties. At dispute time, only the **payment** is provable —
and it proves the price, not the deal.

## The ScopeGate world: one hash, four anchors

```mermaid
flowchart LR
    subgraph SG["ScopeGate — machine-verifiable deal thread"]
        B1["Gatekeeper adjudication<br/>XML-isolated buyer input,<br/>injection firewall,<br/>3-state verdict + frozen scope"] -->|"SHA-256 of canonical<br/>contract JSON"| B2["PayPal order<br/>custom_id = contract hash<br/>(written to PayPal's ledger,<br/>immutable by either party)"]
        B2 --> B3["Delivery through the gateway<br/>payer-verified email dispatch,<br/>access log: IP · UA · timestamp ·<br/>artifact SHA-256"]
        B3 --> B4["One-click evidence<br/>dossier + defense letter PDF<br/>→ Disputes API provide-evidence"]
    end
    B1 == "same hash" ==> B2
    B2 == "same order" ==> B3
    B3 == "records named by<br/>PayPal policy (email, IP, access)" ==> B4
```

## The delta table (what is actually new, per pain point)

| Pain point (verified in `painpoint-verification.md`) | Old-world failure | ScopeGate mechanism | Innovation type |
|---|---|---|---|
| Scope creep & prompt injection *(the 80% problem)* | Verbal scope, invisible until it's too late; agents can inject instructions into the deal text | **Pre-payment adjudication**: deterministic baseline comparison + LLM classification behind an XML firewall; price moves one way only (ratchet); verdict is ACCEPT / COUNTER / REJECT **before money moves** | Core product innovation — the admission gate itself |
| Dispute black hole *(the 20% problem)* | Evidence assembled by hand after the chargeback; wrong evidence categories; "as agreed" unprovable | **Contract hash anchoring**: the negotiated scope is hashed and written into `purchase_units[0].custom_id` on PayPal's own ledger at order creation; delivery events log exactly the evidence categories PayPal's Intangible Goods Additional Requirements name (recipient email, IP, access); one-click `provide-evidence` submission | The load-bearing crypto primitive — this is the single novel step in the chain |
| Escrow deadlock *(deliberately 0% — borrowed, not built)* | Mutual distrust; self-built escrow = money-transmitter licensing death | **Borrowed rails**: PayPal authorize-then-capture sequencing + the hash-anchored objective contract as the arbitration artifact. We build no custody, no ledger of our own | Not an innovation claim — an explicit scope decision (judges reward knowing what NOT to build) |

## The one-sentence innovation claim

> ScopeGate's innovation is not any single component but the **machine-verifiable thread**:
> one SHA-256 contract hash that is born in the AI adjudication, anchored in PayPal's
> order ledger, and reborn as admissible dispute evidence — turning "what did we agree?"
> from a he-said-she-said into a lookup.

Everything else (LLM classification, injection defenses, delivery logging, PDF export)
is solid engineering in service of that thread — presented as such, not oversold.
