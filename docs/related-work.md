# Related Work: What Already Exists, and the Gap ScopeGate Fills

> Addresses the *Innovation* judging criterion ("how does it differ from existing
> solutions?"). Written 2026-10-26. Every row carries a source, and where a number
> changed recently (Upwork's fee), the change itself is noted — this repo does not
> ship unverified claims (see `painpoint-verification.md` for the house standard).

## The landscape

Agentic-commerce payment rails multiplied through 2025–2026. Independent writeups
converge on a division of labor: AP2 records consent, ACP runs the checkout, x402
moves the money ([Crossmint comparison](https://www.crossmint.com/learn/agentic-payments-protocols-compared),
[Formance comparison](https://www.formance.com/blog/product/ap2-x402-acp-agentic-payment-protocols),
[blockleaders comparison](https://blockleaders.io/ai-agent-payment-protocols-compared)).

| Solution family | What it solves | What it does NOT solve | Sources |
|---|---|---|---|
| **x402** (Coinbase + Cloudflare) | Machine-native payment *execution*: revives the dormant HTTP 402 status code so an agent can pay per API call in stablecoin, instantly; x402 Foundation announced Sep 2025 | Payment execution only. Nothing about what was promised, whether bespoke delivery happened, or who wins when it is disputed | [x402 whitepaper](https://x402.org/wp-content/uploads/sites/10/2026/06/x402-whitepaper.pdf) · [Coinbase blog](https://www.coinbase.com/blog/coinbase-and-cloudflare-will-launch-x402-foundation) |
| **AP2** (Google) | Trust and *consent*: cryptographically verifiable mandates that an authorized human approved what the agent is about to pay (Sep 2025, 60+ partners) | Consent ≠ fulfillment. A mandate proves the buyer agreed to **pay**; it proves nothing about bespoke work delivered weeks later, or what "as agreed" meant | [Google Cloud AP2 announcement](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol) |
| **ACP** (OpenAI + Stripe) | Checkout standardization inside chat surfaces (Instant Checkout): the agent-to-merchant checkout handshake | Same category again: authorization and execution of the payment, not the lifecycle of a bespoke engagement around it | [Crossmint comparison](https://www.crossmint.com/learn/agentic-payments-protocols-compared) |
| **Platform escrow** (Upwork, Fiverr) | Milestone escrow + in-house dispute resolution for platform-mediated work | Exists only inside the platform, at double-digit take rates: Fiverr charges sellers a flat 20% commission; Upwork moved to a variable 0–15% freelancer fee in May 2025 (previously flat 10%). An independent developer invoicing a direct client on PayPal has none of it | [Upwork: Freelancer Service Fee](https://support.upwork.com/hc/en-us/articles/211062538-Learn-about-the-Freelancer-Service-Fee) · [FreelanceCompare: Fiverr fees](https://freelancecompare.com/blog/fiverr-fees-explained) |
| **Chargeback automation** (Chargeflow and similar) | Automates the seller's *response* after a dispute has already landed | Reactive by definition. Evidence must already exist in a category the adjudicator accepts; automation can only repackage what was captured at transaction time — which for bespoke intangible work is usually nothing | [chargeflow.io](https://www.chargeflow.io/) |
| **PayPal native** (Seller Protection, Resolution Center, Disputes API) | The adjudication itself: named admissible evidence categories, a structured disputes pipeline, buyer/seller protection rules | The rails and the rules, but no seller-side machinery. For bespoke intangible work PayPal names exactly what it accepts (recipient email, IP, access records, fulfillment "as agreed") and leaves *producing* it to the seller at dispute time — verified in [`painpoint-verification.md`](./painpoint-verification.md) claims #1 and #7 | [PayPal Seller Protection](https://www.paypal.com/us/legalhub/paypal/seller-protection) · this repo's live sandbox E2E run (2026-10-22) |
| **On-chain escrow / milestone protocols** | Custody-neutral escrow without a money-transmitter license | Custody ≠ adjudication: a smart contract can release funds on a signature, but cannot decide whether "the logo matches what we agreed" — and the target users bill clients on fiat rails | — |

## The gap, in one paragraph

The industry is already debating what it calls the *hidden liability* of agentic
commerce — when an agent's payment goes wrong, "who becomes the agent-of-record"
is an open question ([Fintech Wrapup deep dive](https://www.fintechwrapup.com/p/deep-dive-the-hidden-liability-of)).
Every solution above converges on the same half of the problem: **making the
payment happen correctly.** None owns what happens after delivery of *bespoke*
work — the scope-creep fight, the "item not received" chargeback on something
with no tracking number, the he-said-she-said over "what did we actually agree?"
That half is ScopeGate's entire surface.

## Positioning: complementary, not competitive

> x402 / AP2 / ACP answer **how an agent pays.**
> ScopeGate answers **what happens when the deal goes wrong.**

- AP2 mandates and ScopeGate's contract hash are orthogonal artifacts: a mandate
  proves *authorization to pay*; the hash pins *what was agreed* and anchors the
  *evidence that it was delivered*. An AP2-style flow could carry a ScopeGate
  hash exactly the way a PayPal order carries it in `custom_id`.
- x402 prices machine-to-machine micro-payments per request. For anything
  *bespoke* — negotiated scope, milestones, subjective acceptance — a per-call
  payment still needs the pre-payment scope adjudication and the post-delivery
  evidence chain that ScopeGate demonstrates on PayPal's rails.
- PayPal's native tooling is the adjacency ScopeGate builds **on**, not against:
  the Disputes API `provide-evidence` call, the webhook pipeline, and the Seller
  Protection evidence categories are used as-is. ScopeGate is the missing
  seller-side capture layer that makes those native surfaces winnable for
  bespoke intangible work.

## Why this qualifies as innovation

The one-sentence claim (full version in [`architecture-comparison.md`](./architecture-comparison.md)):
the **machine-verifiable thread** — one SHA-256 contract hash born in the AI
adjudication, anchored in PayPal's order ledger, reborn as admissible dispute
evidence. No solution listed above produces adjudicator-native evidence *at
transaction time* for bespoke intangible services; the closest behaviors
(platform escrow, chargeback automation) are either walled inside a marketplace
or start only after the dispute exists.
