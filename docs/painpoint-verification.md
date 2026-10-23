# Pain-Point Verification: What We Claim vs. What the Rules Actually Say

> Every load-bearing claim about the dispute/chargeback landscape, checked against
> primary sources (official PayPal policy text, Visa core rules, PayPal's public
> OpenAPI specifications, and our own live sandbox end-to-end run on 2026-10-22 —
> order → capture → INR dispute → `provide-evidence` accepted).
> Inspired by advisor review 2026-10-23: *don't let AI-generated claims stand in for
> the actual rules.*

| # | Claim (as originally worded) | Verdict | What the sources actually say | Source |
|---|------------------------------|---------|-------------------------------|--------|
| 1 | "Intangible services have no physical tracking number, so sellers lose INR disputes" | **Confirmed, with nuance** | PayPal's Seller Protection is not categorically closed to intangibles: since 2020 they are covered **if** the transaction is flagged eligible **and** the seller meets the *Intangible Goods Additional Requirements* — producing "compelling evidence to show the item was delivered or the purchase order was fulfilled": evidence that it was "electronically sent to the recipient, **including the recipient's address (email, IP, etc.)**" or that it was "**received or accessed by the recipient**." The black hole is not eligibility — it is that independent sellers don't produce admissible evidence. That evidence-production gap is exactly what ScopeGate automates (payer-verified email + dispatch + access log with IP/timestamp + artifact hash). | [PayPal Seller Protection Program (US Legal Hub)](https://www.paypal.com/us/legalhub/paypal/seller-protection) |
| 2 | "Dossier complies with PayPal Seller Protection **Section 11**" | **Refuted — citation corrected** | The US Seller Protection policy is **not organized into numbered sections**; there is no "Section 11." The real anchor is the *Intangible Goods Additional Requirements* clause. All repo artifacts (dossier schema, defense letter, OpenAPI descriptions) were corrected on 2026-10-23 to cite the actual clause. Lesson recorded in `docs/failed-experiments.md` spirit: verify legal citations before shipping them to judges. | [PayPal Seller Protection Program (US Legal Hub)](https://www.paypal.com/us/legalhub/paypal/seller-protection) |
| 3 | "Buyer chargebacks (card-rail) hit sellers too" | **Confirmed — and stronger than we claimed** | PayPal's own policy: "Item Not Received claims stemming from buyer chargebacks on card-funded transactions are excluded" from Seller Protection. For those, the fight moves to the card network's rules. Under Visa dispute condition 13.1 (merchandise/services not received), the merchant response must show the cardholder "received the merchandise or services **as agreed**" — for services, literally *proof that services were rendered as agreed*. "As agreed" requires a provable agreement; a verbal/chat scope cannot prove one, a hash anchored in PayPal's own order ledger can. | [PayPal Seller Protection](https://www.paypal.com/us/legalhub/paypal/seller-protection) · [Visa Core Rules (official PDF)](https://usa.visa.com/dam/VCOM/download/about-visa/visa-rules-public.pdf) |
| 4 | "Sellers' screenshots/GitHub links get rejected by reviewers" | **Confirmed (first-hand + community)** | PayPal's admissible-evidence categories for intangibles are named (email/IP/access records — claim #1); free-form screenshots are not among them. Our live sandbox run corroborates the machinery: the Disputes API `PROOF_OF_FULFILLMENT` evidence type requires structured `tracking_info`, the Resolution Center models "服务 / 数字商品下载" as first-class item types, and the sandbox buyer flow produced an INR case (`PP-R-LKW-10194104`) that demanded a structured seller response. Community first-hand cases: `docs/evidence-table.md` (6 cases). | PayPal public OpenAPI spec (`customer_disputes_v1.json`) · live sandbox run 2026-10-22 · [evidence table](./evidence-table.md) |
| 5 | "Dispute/chargeback costs the seller a fee on top of the amount" | **Confirmed (region-dependent)** | PayPal charges a chargeback/dispute handling fee per case (US: $20 as of the 2019 update; historically $15). Region and program dependent. | [PayPal Seller Protection / fee schedule](https://www.paypal.com/us/legalhub/paypal/seller-protection) |

## What this changes in our story (honest framing for judges)

- We do **not** claim PayPal abandons intangible sellers. We claim the burden of proof is
  on the seller, the admissible evidence categories are specific (recipient email, IP,
  access records, fulfillment proof "as agreed"), and bespoke-service sellers structurally
  fail to produce them because nothing in their workflow *captures* them at the right
  moments. ScopeGate's contribution is making that evidence a **by-product of the
  transaction itself** rather than a scramble after the chargeback email.
- The single sharpest verified wedge is claim #3: card-rail INR is excluded from Seller
  Protection entirely, and Visa 13.1 turns on services "rendered **as agreed**" —
  which makes a machine-verifiable agreement (contract hash in `custom_id`) the
  load-bearing artifact, not a nice-to-have.
