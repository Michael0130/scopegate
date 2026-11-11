# Old World vs. ScopeGate: Where the Architecture Actually Changes

> Advisor-directed framing: show the delta, not the whole system.
> Read this side-by-side with [`showcase/painpoint-verification.md`](./painpoint-verification.md) — every annotated
> difference below is tied to a verified pain point.

---

## 1. The Old World: Four Disconnected Artifacts

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

---

## 2. The ScopeGate World: One Hash, Four Anchors

```mermaid
flowchart LR
    subgraph SG["ScopeGate — machine-verifiable deal thread"]
        B1["Pre-Payment Adjudication<br/>Core Agent + Scope Referee Skill<br/>XML-isolated buyer input · 9 injection defenses<br/>3-state verdict + ratchet pricing"] -->|"SHA-256 of canonical<br/>contract JSON"| B2["PayPal Order Ledger<br/>custom_id = contract_hash:milestone<br/>(written to PayPal's immutable ledger,<br/>tamper-proof by either party)"]
        B2 --> B3["Fulfillment Vault Gateway<br/>payer-verified download dispatch<br/>access log: IP · UA · timestamp ·<br/>artifact SHA-256"]
        B3 --> B4["One-Click Admissible Defense<br/>Dossier + dispute evidence packet<br/>→ Direct PayPal Disputes API"]
    end
    B1 == "same hash" ==> B2
    B2 == "same order" ==> B3
    B3 == "records named by<br/>PayPal policy (email, IP, access)" ==> B4
```

---

## 3. The Agentic Architecture Evolution: Single Agent + Modular Skills

A common pitfall in AI commerce is building a **"Multi-Agent Mesh"** where 5 different agents (Concierge, Gatekeeper, Finance, Delivery, Legal) pass conversational messages back and forth. 

### Why Multi-Agent Mesh Failed:
- **10,000-Token Prompt Explosion**: Every user turn dumped all 5 agent profiles, complete legal text, and seller portfolios into context (over 23.6 KB JSON).
- **Latency & Hallucination**: Chained agent-to-agent chatter introduced latency spikes (10s+) and hallucinated financial figures.

### ScopeGate's Single Core Agent + Mounted Skills Architecture:
ScopeGate replaces virtual conversational roles with **one embodied Core Commerce Agent** backed by modular, on-demand **Skills**:

```mermaid
flowchart TD
    subgraph RUNTIME["Embodied Core Commerce Agent (~800 Token Lean Prompt)"]
        CA["Core Commerce Agent<br/>(Represents Merchant Directly)"]
    end

    subgraph DOMAIN_SKILLS["Merchant Domain Skills (5 per Seller)"]
        DS1["alex-nextjs-landing-page"]
        DS2["alex-craftsman-profile<br/>(In-memory BM25 indexer tool)"]
        DS3["alex-code-handover"]
        DS4["alex-performance-tuning"]
        DS5["alex-tailwind-theming"]
    end

    subgraph PLATFORM_SKILLS["Platform Referee Skills (Deterministic Code Tools)"]
        PS1["scope-referee<br/>(check_exclusions, 9-pattern injection scanner)"]
        PS2["paypal-settlement<br/>(compute_quote, plan_milestones: 40/60 split)"]
        PS3["evidence-vault<br/>(verify_delivery_hash, export_dossier)"]
    end

    CA -->|"BM25 query"| DS2
    CA -->|"Scope veto"| PS1
    CA -->|"Code pricing"| PS2
    CA -->|"Dispute audit"| PS3
```

- **90% Prompt Reduction**: Base system prompt reduced to ~800 tokens.
- **In-Memory BM25 Indexer**: Domain knowledge and past case studies are recalled dynamically via pure Node.js BM25 indexing in under 5ms.
- **Zero LLM Math on Money**: The LLM is stripped of pricing arithmetic. The model identifies matched baseline surcharge rules; deterministic Node.js code tools compute quotes and 40/60 milestone splits.

---

## 4. The Delta Table (What is Actually New, per Pain Point)

| Pain point (verified in `painpoint-verification.md`) | Old-world failure | ScopeGate mechanism | Innovation type |
|---|---|---|---|
| **Scope creep & prompt injection** *(the 80% problem)* | Verbal scope, invisible until it's too late; agents can inject instructions into the deal text | **Pre-payment adjudication**: deterministic baseline comparison + LLM classification behind an XML firewall; price moves one way only (ratchet); verdict is ACCEPT / COUNTER / REJECT **before money moves** | Core product innovation — the admission referee itself |
| **Prompt token bloat & agent chatter** *(the latency problem)* | Dumping 5 agents into a 10,000-token prompt creates high latency and hallucinated negotiations | **Single Agent + Skills**: 1 embodied Core Agent, ~800 token prompt, in-memory BM25 indexer tool for knowledge, and deterministic code tools for pricing | Architecture innovation — modular agentic design |
| **Dispute black hole** *(the 20% problem)* | Evidence assembled by hand after the chargeback; wrong evidence categories; "as agreed" unprovable | **Contract hash anchoring**: the negotiated scope is hashed into a 64-char hex SHA-256 and written into `purchase_units[0].custom_id` on PayPal's own ledger at order creation; delivery events log exactly what PayPal's Intangible Goods Requirements mandate (recipient email, IP, access); one-click `provide-evidence` submission | The load-bearing crypto primitive — immutable ledger anchoring |
| **Escrow deadlock** *(deliberately 0% — borrowed, not built)* | Mutual distrust; self-built escrow = money-transmitter licensing death | **Borrowed rails**: PayPal milestone sequencing (deposit → stages → final; one anchored order per stage, next stage unlocks on logged acceptance) + hash-anchored contract. We build no custody, no ledger of our own | Strategic non-innovation — explicit regulatory boundary decision |

---

## 5. The One-Sentence Innovation Claim

> ScopeGate's innovation is not any single component but the **machine-verifiable thread**:
> one SHA-256 contract hash that is born in AI adjudication, anchored in PayPal's
> order ledger (`custom_id`), and reborn as admissible dispute evidence — turning "what did we agree?"
> from a he-said-she-said into an immutable cryptographic lookup.
