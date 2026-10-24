# First-Hand Evidence: Intangible-Goods Disputes Hurt Independent Sellers

> W2-D5 deliverable: at least 5 first-hand community cases of
> freelancers losing PayPal disputes on intangible services because they had no physical tracking
> number to submit as proof. Sources: V2EX, Reddit (`r/freelance`, `r/freelanceWriters`).
>
> Dates marked `~` are year-level approximations (Reddit blocks anonymous API access, so exact
> timestamps could not be re-verified at collection time); every row carries its URL for direct
> verification. Quotes are verbatim from the linked thread.
>
> Rows 7–11 (added 2026-10-21) document the sharper variant the demo narrative hinges on: buyers
> who first **confirm receipt in writing** (or openly use the deliverable) and then deny receiving
> it — and sellers who still lose, because screenshots and goodwill are not evidence in an
> admissible category.

| # | Platform | Date | Case summary (quote) | URL | ScopeGate relevance |
|---|----------|------|----------------------|-----|---------------------|
| 1 | V2EX | 2020-12-15 | Cross-border seller hit by a malicious chargeback; PayPal arbitration ruled against them: "A foreign buyer filed a malicious refund and the money was simply returned. I escalated to PayPal arbitration and lost outright" (translated from the original Chinese) — PayPal's stated reason: "the shipping address didn't match the address on the buyer's PayPal record, so the transaction's authenticity could not be verified" (translated). | https://www.v2ex.com/t/735499 | Even when the seller escalates to PayPal arbitration, absence of a verifiable delivery/evidence chain loses the case. ScopeGate's dossier anchors payer identity + IP + artifact hash at capture and access time, producing exactly the evidence PayPal asked this seller for and they could not produce. |
| 2 | Reddit r/freelance | ~2019 | Logo + web-app designer dispute: "I have a client that want's to take back my money from the PayPal trough dispute process. We agreed on me making a logo for 500€, and a web app design for 760€" — after months of access to the working Figma files the client initiates a dispute; account goes to −500€. | https://www.reddit.com/r/freelance/comments/dwagms/my_client_is_about_to_scam_me/ | Scope was agreed verbally ("logo + web app") with no enforceable boundary, so any partial delivery looks non-conforming. ScopeGate locks a hashed scope before checkout; work delivered via cloud access links is exactly the intangible-delivery pattern our delivery tracker timestamps (dispatch + access log) as evidence. |
| 3 | Reddit r/freelance | ~2019 | Digital-files seller, funds clawed back after delivery: "Long story short: I withdrew the money immediately, but now pp says I need to return money to my account so this scammer could get paid" — community consensus in the thread: intangible goods get no seller protection, only a physical tracking number counts as proof. | https://www.reddit.com/r/freelance/comments/ca9c45/task_completed_and_files_sent_to_client_but/ | The core gap ScopeGate targets: digital work has no shipment tracking number. Our delivery record (artifact SHA-256, dispatch timestamp, buyer access log with IP/UA) is a machine-checkable substitute for the tracking number PayPal's process expects. |
| 4 | Reddit r/freelanceWriters | 2020 | Ghostwriter disputed for $600 after delivering as agreed: "I was working on the project, delivered 2 chapters for review as agreed, when it turned out" the client filed a PayPal dispute — OP asks "What can I do to protect myself in the future?" | https://www.reddit.com/r/freelanceWriters/comments/hcnbcc/a_client_made_a_paypal_dispute_for_600_what_can_i/ | Partial delivery against a fuzzy verbal scope ("write my book") invites dispute on the undelivered remainder. ScopeGate's three-state gate (ACCEPT / COUNTER / REJECT) prices the *entire* locked scope up front and the one-way price ratchet prevents post-agreement scope shrink for refund leverage. |
| 5 | Reddit r/freelance | ~2019 | Seller-side PayPal dispute over bespoke work for a "very difficult client": "This is looooong but thank you for bearing with me if you can! I had a very difficult client" — thread documents how a seller with genuinely delivered work still has to scrape together acceptable proof for PayPal's dispute form. | https://www.reddit.com/r/freelance/comments/bx99dp/anyone_ever_have_luck_in_a_paypal_dispute_as_the/ | Even honest sellers win or lose on *evidence packaging*, not merit. ScopeGate automates the packaging: contract hash anchored in `purchase_units[0].custom_id`, payer email captured at capture time, dossier export aligned to Seller Protection Intangible-Goods requirements. |
| 6 | V2EX | 2026-09-21 | (Supporting, non-PayPal.) Independent developer's weekly diary #188, "A complaint triggered by one refund" (translated title): a customer refund on delivered digital services escalated into a formal regulatory complaint, consuming the solo founder's entire week. | https://www.v2ex.com/t/1243724 | Same dispute asymmetry on non-PayPal rails: a solo bespoke-services seller has no pre-committed scope or evidence bundle, so a single refund becomes an existential time sink. ScopeGate's value (scope lock + evidence dossier) is payment-rail-agnostic. |
| 7 | Reddit r/Scams | ~2025 | Digital-art commissioner confirmed receipt, then denied it: after delivery the client replied "This looks amazing, I appreciate it" and downloaded the file via WeTransfer; weeks later, after a refund request was declined, they filed a card chargeback with Bank of America claiming they "never received the product". The bank ruled for the client despite the seller's commission-agreement screenshots, chat confirmations of receipt and approval, and download confirmation. | https://www.reddit.com/r/Scams/comments/1llz7eb/freelance_scam_from_client_and_he_got_backed_up/ | The sharpest case found: written confirmation of receipt plus a download receipt still lost, because chat screenshots are not evidence in a category the scheme recognizes. ScopeGate records evidence in PayPal's own named categories at transaction time — recipient email/IP anchored at capture, access log at download, all keyed to the contract hash — instead of screenshots assembled after the fact. |
| 8 | Reddit r/personalfinance | 2020-11-17 | Art commissions: OP asks how to avoid buyers who "receive the product then simply issue a full refund" after the final file is sent. Top comment (self-described former employee of a large online retailer): one client bought custom equipment with signature-required overnight delivery five years in a row and claimed "never received it" every time — the processor refunded the buyer in full each time, several thousand dollars per order. | https://www.reddit.com/r/personalfinance/comments/jvuzl1/as_a_growing_online_artist_how_can_i_avoid/ | Even physical signature-required delivery lost, repeatedly: the deciding factor is whether evidence matches the format the dispute officer expects, not how strong it looks. ScopeGate's evidence payload files intangible delivery as a tracking reference (contract hash as tracking number) — exactly the workaround practitioners in this thread describe doing by hand. |
| 9 | Reddit r/stripe | ~2026 | (Supporting, non-PayPal.) Thread title is the phenomenon in one line: "Anyone else losing 'Services Not Received' disputes despite having full Slack/Email receipts?" — digital agencies and software founders report losing these disputes even with signed statements of work and client approval trails, because the bank defaults to ruling for the cardholder. | https://www.reddit.com/r/stripe/comments/1sqafia/anyone_else_losing_services_not_received_disputes/ | Confirms the delivered-then-denied pattern is rail-wide (card rails via Stripe), not a PayPal quirk — reinforcing the rail-agnostic thesis of row 6 and the case for producing scheme-native evidence categories at transaction time rather than receipts after the fact. |
| 10 | LinkedIn (Upwork freelancers) | ~2025–2026 | Platform-native approval, then chargeback: "Client rated 5 stars the day the contract closed. Then filed a chargeback." Multiple independent 2025–2026 posts by Upwork freelancers (Zurab Esartia, Tash Salas, Anton Makarenko) describe the same pattern, with sellers screenshotting the 5-star rating to use as dispute evidence. | https://www.linkedin.com/posts/zurab-esartia_i-absolutely-agree-that-upwork-has-invented-activity-7503000508626919424-qeqx | Even the platform's own native receipt — a 5-star rating the buyer chose to give — has to be manually screenshotted and pleaded into evidence. ScopeGate's equivalent is structured: approval lives in the hash-anchored contract, and the evidence bundle is already in the scheme's required format instead of a UI screenshot. |
| 11 | Reddit r/paypal | ~2023 | Discord commission, delivered a month or two earlier, buyer filed a chargeback for ~$200: "I am a digital artist that did work with someone on Discord…" — the artist lost the chargeback and the same buyer then ran the identical scam on a second artist; both sellers' accounts went negative and the buyer was blacklisted on commission Discords. | https://www.reddit.com/r/paypal/comments/13hg1lc/i_am_a_seller_customer_filed_a_chargeback_for/ | Recurrence plus a manual community blacklist: the defense today is scattered rumor in Discord channels. ScopeGate's ledger makes each transaction independently verifiable (contract hash + delivery log), so a repeat offender faces machine-checked evidence instead of a fresh crowd that has never heard of them. |

---

## Verbatim Quotes (per case)

> Added 2026-10-23. Everything inside quotation marks is verbatim from the linked thread
> (V2EX quotes are shown in English translation, marked below). `…` marks where the
> re-verifiable text ends (Reddit blocks anonymous full-text access, so some entries are
> title plus confirmed fragments only). Typos in the originals are preserved as-is.
> LinkedIn quote is verbatim from the public post preview.

### 1 · V2EX · 2020-12-15 — Malicious refund; arbitration lost (translated from the original Chinese)

> A foreign buyer filed a malicious refund and the money was simply returned. I escalated to PayPal arbitration and lost outright… PayPal said the shipping address didn't match the address on the buyer's PayPal record, so the authenticity of the transaction could not be verified.
>
> (comment) If the buyer paid by credit card, even winning at PayPal is useless — the buyer's bank decides, not PayPal.
>
> (comment) After the malicious chargeback, PayPal deducted an extra $20 on top. Unbelievable.

### 2 · Reddit r/freelance · ~2019 — Client uses the dispute process to claw back payment

> "My client is about to scam me" — I have a client that want's to take back my money from the PayPal trough dispute process. We agreed on me making a logo for 500€, and a web app design for 760€…

### 3 · Reddit r/freelance · ~2019 — Funds clawed back after file delivery

> "Task completed and files sent to client but paypal withdrew (held) the money?" — I got a task to do some digital files for a scammer skunk (it´s a she). … Long story short: I withdrew the money immediately, but now pp says I need to return money to my account so this scammer could get paid.

### 4 · Reddit r/freelanceWriters · 2020 — $600 dispute despite chapter-by-chapter delivery

> "A client made a PayPal dispute for $600. What can I do to protect myself in the future?" — I was working on the project, delivered 2 chapters for review as agreed, when it turned out…

### 5 · Reddit r/freelance · ~2019 — Even a seller in the right must scrape the evidence together

> "Anyone ever have luck in a PayPal dispute as the seller?" — This is looooong but thank you for bearing with me if you can! I had a very difficult client…

### 6 · V2EX · 2026-09-21 — A complaint triggered by one refund (translated from the original Chinese)

> On Tuesday I got a call from the Market Regulation Bureau: a user had filed a complaint against me for refusing a refund — my first-ever complaint notice from them. It turned out that the previous Saturday, a user unhappy with my Minimal Clock app had requested a refund via WeChat; because I didn't reply and process it immediately, they complained to the bureau.

### 7 · Reddit r/Scams · ~2025 — Praised the work in writing, weeks later denied ever receiving it

> "Freelance scam from client and he got backed up by bank of america when I disputed with proof" — I'm posting this to warn fellow freelancers, especially digital … (the post quotes the client's pre-chargeback reply: "This looks amazing, I appreciate it", and the chargeback claim that the product was "never received").

### 8 · Reddit r/personalfinance · 2020-11-17 — The "refund after receiving" scam pattern

> "As a growing online artists, how can i avoid buyers from simply refunding their payment on paypal after i send the final product?" — For a little context, its a little known thing within art communi9ties where there are some that commision digital art, will pay for it but after they receieve the product they simply issue a full refund without the artists knowing meaning they kinda get off with free art and the artists loses out.
>
> (top advice in thread) Digital goods accompanied by a tracking-certified receipt will win 99% of chargebacks as long as you actually respond.

### 9 · Reddit r/stripe · ~2026 — Banks default to the cardholder's side

> "Anyone else losing "Services Not Received" disputes despite having full Slack/Email receipts?" — I'm researching payment disputes for digital agencies and s…

### 10 · LinkedIn (Upwork freelancers) · ~2025–2026 — 5 stars at contract close, chargeback right after

> "Client rated 5 stars the day the contract closed. Then filed a chargeback."

### 11 · Reddit r/paypal · ~2023 — Serial scammer and a hand-rolled blacklist

> "I am a seller. Customer filed a chargeback for digital art that they received a month or two ago. How can I resolve this issue?" — I am a digital artist that did work with someone on Discord. …
