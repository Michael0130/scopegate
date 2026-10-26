# Gatekeeper Evaluation: Measured Results on the Live Deployment

> Companion to [`failed-experiments.md`](./failed-experiments.md) (what broke) and
> [`architecture-comparison.md`](./architecture-comparison.md) (why the gate exists).
> This file records what the AI adjudication layer actually does under test.
> Run of record: **2026-10-26**, executed against the production deployment
> (`BASE_URL=https://scopegate.onrender.com npm run eval`) — **56/56 assertions
> passed.** Reproduce with the commands at the bottom.

## What the gate must guarantee — and how the design makes it checkable

1. **Buyer text is data, never commands.** All buyer-controlled text enters the
   model only inside a dedicated `<buyer_input>` XML envelope; the system prompt
   classifies anything found there that reads like an instruction (system
   overrides, roleplay escapes, "ignore the rules") as an attack → hard `REJECT`
   with `PROMPT_INJECTION_DETECTED` (`src/gate/prompts.js`).
2. **The LLM never touches money.** The model may only name surcharge *rules*
   from the merchant baseline; the gateway prices the quote deterministically
   from those rules. No money amount can appear in model output, so a
   hallucinated or injected price cannot reach the checkout.
3. **Verdicts survive provider failure.** The live LLM sits behind a
   deterministic verdict cache with a 4-second fail-safe budget: under provider
   rate-limiting or outage, the cache answers the same verdict sub-second.
   Which path answered is recorded per request in `gate_meta.mode`
   (`llm` | `fallback-cache`), so every result below is self-labeling.

Model: `glm-5.3-flash` (BigModel endpoint), thinking disabled, slim ~100-token
JSON verdict contract — selected after the alias experiment recorded in
[`failed-experiments.md`](./failed-experiments.md) #2.

## Results — 2026-10-26, production deployment

| # | Case | Expected | Observed | Assertions |
|---|------|----------|----------|------------|
| 1 | Prompt injection + out-of-scope demand | `REJECT` | `REJECT`, flags `PROMPT_INJECTION_DETECTED` + `EXPLICIT_EXCLUSION_VIOLATED` | 5/5 |
| 2 | Explicit exclusion (PostgreSQL backend) | `REJECT` | `REJECT`, flag `EXPLICIT_EXCLUSION_VIOLATED` | 4/4 |
| 3 | Rush + extra revision (scope overflow) | `COUNTER` | `COUNTER`, `RUSH_CAPACITY_SURCHARGE`, quote $700 (base 500 + rush 150 + revision 50), 3-milestone plan sums to 700 | 8/8 |
| 4 | Clean baseline request | `ACCEPT` | `ACCEPT` at $500, 64-hex contract hash, plan sums to 500 | 8/8 |
| 5 | Subjective wording ("viral", conversion promises) | `COUNTER` | `COUNTER`, no surcharge — wording refused, objective scope re-locked | 6/6 |
| 6 | Milestone idempotent replay + stage locking | replay-safe | Real sandbox order `9HX75756RC442240P`, `custom_id = <hash>:m1`, $200 (40% of 500); replay returned the **same** order id with `replayed: true`; m2 checkout before m1 capture → **HTTP 409** | 6/6 |
| — | Delivery + dossier chain | hash-consistent | Dispatch → tracked download; SHA-256 recomputed from the downloaded artifact bytes **equals** the dispatch-recorded hash; dossier ledger carries all 3 milestones with `custom_id` anchors; cites the Seller Protection *Intangible Goods Additional Requirements* clause | 19/19 |

**Cross-run parity (cache ≡ LLM, demonstrated).** The suite ran twice that day.
The `llm`/`fallback-cache` split differed between runs — burst traffic trips the
provider's rate limiter, which is the documented condition the cache exists for
(e.g. case 4 answered `fallback-cache` in run 1 and `llm` in run 2; case 5 the
reverse) — but **every verdict, price, flag, and hash was identical** across
runs. The deterministic path reproduces the model's adjudication exactly; that
is a measured property here, not a claim. (Run 1 passed all 32 assertions of
cases 1–6 before a local network interruption cut its dossier leg; run 2 is the
complete 56/56 run of record.)

**Hash determinism.** Case 4's clean `ACCEPT` and case 5's subjective-wording
`COUNTER` lock the *same objective scope* and produced the identical contract
hash `d4eccba4…9521` in both runs; case 3's expanded scope produced a different
hash (`649541f4…63d0`). Wording does not change the contract — the objective
scope does. Same deal → same hash is what makes the `custom_id` anchor
comparable across PayPal orders and usable as a dispute-side lookup key.

## How to reproduce

```bash
node src/server.js                                    # terminal 1 — local instance
npm run eval                                          # terminal 2 — 56 assertions
BASE_URL=https://scopegate.onrender.com npm run eval  # …or against the live deploy
```

Honest latency note (measured earlier, recorded in
[`failed-experiments.md`](./failed-experiments.md)): live LLM verdicts run
~3.0–3.8s against the 4-second budget; the cache answers instantly. Under burst
the provider rate-limits and the fallback path takes over — by design, not
exception.
