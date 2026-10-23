# First-Hand Evidence: Intangible-Goods Disputes Hurt Independent Sellers

> W2-D5 deliverable (Master Spec §5, research item 4): at least 5 first-hand community cases of
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
| 1 | V2EX | 2020-12-15 | Cross-border seller hit by a malicious chargeback; PayPal arbitration ruled against them: "国外的用户发起申请恶意退款，钱直接退了。找 PayPal 申请仲裁，直接判输" — PayPal's stated reason: "发货地址 和用户记录在 Paypal 的地址不一致，所以无法证实交易的真实性" (shipping address mismatched the buyer's PayPal record, so the transaction could not be verified). | https://www.v2ex.com/t/735499 | Even when the seller escalates to PayPal arbitration, absence of a verifiable delivery/evidence chain loses the case. ScopeGate's dossier anchors payer identity + IP + artifact hash at capture and access time, producing exactly the evidence PayPal asked this seller for and they could not produce. |
| 2 | Reddit r/freelance | ~2019 | Logo + web-app designer dispute: "I have a client that want's to take back my money from the PayPal trough dispute process. We agreed on me making a logo for 500€, and a web app design for 760€" — after months of access to the working Figma files the client initiates a dispute; account goes to −500€. | https://www.reddit.com/r/freelance/comments/dwagms/my_client_is_about_to_scam_me/ | Scope was agreed verbally ("logo + web app") with no enforceable boundary, so any partial delivery looks non-conforming. ScopeGate locks a hashed scope before checkout; work delivered via cloud access links is exactly the intangible-delivery pattern our delivery tracker timestamps (dispatch + access log) as evidence. |
| 3 | Reddit r/freelance | ~2019 | Digital-files seller, funds clawed back after delivery: "Long story short: I withdrew the money immediately, but now pp says I need to return money to my account so this scammer could get paid" — community consensus in the thread: intangible goods get no seller protection, only a physical tracking number counts as proof. | https://www.reddit.com/r/freelance/comments/ca9c45/task_completed_and_files_sent_to_client_but/ | The core gap ScopeGate targets: digital work has no shipment tracking number. Our delivery record (artifact SHA-256, dispatch timestamp, buyer access log with IP/UA) is a machine-checkable substitute for the tracking number PayPal's process expects. |
| 4 | Reddit r/freelanceWriters | 2020 | Ghostwriter disputed for $600 after delivering as agreed: "I was working on the project, delivered 2 chapters for review as agreed, when it turned out" the client filed a PayPal dispute — OP asks "What can I do to protect myself in the future?" | https://www.reddit.com/r/freelanceWriters/comments/hcnbcc/a_client_made_a_paypal_dispute_for_600_what_can_i/ | Partial delivery against a fuzzy verbal scope ("write my book") invites dispute on the undelivered remainder. ScopeGate's three-state gate (ACCEPT / COUNTER / REJECT) prices the *entire* locked scope up front and the one-way price ratchet prevents post-agreement scope shrink for refund leverage. |
| 5 | Reddit r/freelance | ~2019 | Seller-side PayPal dispute over bespoke work for a "very difficult client": "This is looooong but thank you for bearing with me if you can! I had a very difficult client" — thread documents how a seller with genuinely delivered work still has to scrape together acceptable proof for PayPal's dispute form. | https://www.reddit.com/r/freelance/comments/bx99dp/anyone_ever_have_luck_in_a_paypal_dispute_as_the/ | Even honest sellers win or lose on *evidence packaging*, not merit. ScopeGate automates the packaging: contract hash anchored in `purchase_units[0].custom_id`, payer email captured at capture time, dossier export aligned to Seller Protection Intangible-Goods requirements. |
| 6 | V2EX | 2026-09-21 | (Supporting, non-PayPal.) Independent developer's weekly diary #188, "一次退款引发的投诉": a customer refund on delivered digital services escalated into a formal regulatory complaint, consuming the solo founder's entire week. | https://www.v2ex.com/t/1243724 | Same dispute asymmetry on non-PayPal rails: a solo bespoke-services seller has no pre-committed scope or evidence bundle, so a single refund becomes an existential time sink. ScopeGate's value (scope lock + evidence dossier) is payment-rail-agnostic. |
| 7 | Reddit r/Scams | ~2025 | Digital-art commissioner confirmed receipt, then denied it: after delivery the client replied "This looks amazing, I appreciate it" and downloaded the file via WeTransfer; weeks later, after a refund request was declined, they filed a card chargeback with Bank of America claiming they "never received the product". The bank ruled for the client despite the seller's commission-agreement screenshots, chat confirmations of receipt and approval, and download confirmation. | https://www.reddit.com/r/Scams/comments/1llz7eb/freelance_scam_from_client_and_he_got_backed_up/ | The sharpest case found: written confirmation of receipt plus a download receipt still lost, because chat screenshots are not evidence in a category the scheme recognizes. ScopeGate records evidence in PayPal's own named categories at transaction time — recipient email/IP anchored at capture, access log at download, all keyed to the contract hash — instead of screenshots assembled after the fact. |
| 8 | Reddit r/personalfinance | 2020-11-17 | Art commissions: OP asks how to avoid buyers who "receive the product then simply issue a full refund" after the final file is sent. Top comment (self-described former employee of a large online retailer): one client bought custom equipment with signature-required overnight delivery five years in a row and claimed "never received it" every time — the processor refunded the buyer in full each time, several thousand dollars per order. | https://www.reddit.com/r/personalfinance/comments/jvuzl1/as_a_growing_online_artist_how_can_i_avoid/ | Even physical signature-required delivery lost, repeatedly: the deciding factor is whether evidence matches the format the dispute officer expects, not how strong it looks. ScopeGate's evidence payload files intangible delivery as a tracking reference (contract hash as tracking number) — exactly the workaround practitioners in this thread describe doing by hand. |
| 9 | Reddit r/stripe | ~2026 | (Supporting, non-PayPal.) Thread title is the phenomenon in one line: "Anyone else losing 'Services Not Received' disputes despite having full Slack/Email receipts?" — digital agencies and software founders report losing these disputes even with signed statements of work and client approval trails, because the bank defaults to ruling for the cardholder. | https://www.reddit.com/r/stripe/comments/1sqafia/anyone_else_losing_services_not_received_disputes/ | Confirms the delivered-then-denied pattern is rail-wide (card rails via Stripe), not a PayPal quirk — reinforcing the rail-agnostic thesis of row 6 and the case for producing scheme-native evidence categories at transaction time rather than receipts after the fact. |
| 10 | LinkedIn (Upwork freelancers) | ~2025–2026 | Platform-native approval, then chargeback: "Client rated 5 stars the day the contract closed. Then filed a chargeback." Multiple independent 2025–2026 posts by Upwork freelancers (Zurab Esartia, Tash Salas, Anton Makarenko) describe the same pattern, with sellers screenshotting the 5-star rating to use as dispute evidence. | https://www.linkedin.com/posts/zurab-esartia_i-absolutely-agree-that-upwork-has-invented-activity-7503000508626919424-qeqx | Even the platform's own native receipt — a 5-star rating the buyer chose to give — has to be manually screenshotted and pleaded into evidence. ScopeGate's equivalent is structured: approval lives in the hash-anchored contract, and the evidence bundle is already in the scheme's required format instead of a UI screenshot. |
| 11 | Reddit r/paypal | ~2023 | Discord commission, delivered a month or two earlier, buyer filed a chargeback for ~$200: "I am a digital artist that did work with someone on Discord…" — the artist lost the chargeback and the same buyer then ran the identical scam on a second artist; both sellers' accounts went negative and the buyer was blacklisted on commission Discords. | https://www.reddit.com/r/paypal/comments/13hg1lc/i_am_a_seller_customer_filed_a_chargeback_for/ | Recurrence plus a manual community blacklist: the defense today is scattered rumor in Discord channels. ScopeGate's ledger makes each transaction independently verifiable (contract hash + delivery log), so a repeat offender faces machine-checked evidence instead of a fresh crowd that has never heard of them. |

---

## Verbatim Quotes, 中文对照与概括 (per case)

> Added 2026-10-23. For every case: **概括** (Chinese summary), **原文** (verbatim quote in the
> original language), and a full rendering in the other language (中文↔English). Everything inside
> quotation marks is verbatim; `…` marks where the re-verifiable text ends (Reddit blocks anonymous
> full-text access, so some entries are title plus confirmed fragments only). Typos in the
> originals are preserved as-is. LinkedIn quote is verbatim from the public post preview.

### 1 · V2EX · 2020-12-15 — 恶意退款，PayPal 仲裁判输

**概括**：跨境卖家遭国外买家恶意退款，PayPal 直接把钱退给买家；卖家申请仲裁被判输，理由是"发货地址与买家 PayPal 记录地址不一致，无法证实交易真实性"。评论区补充了两个要害：信用卡付款的拒付连 PayPal 都做不了主（买家银行说了算）；恶意退单还会被多扣 $20 争议费。

**原文（中文）**：
> 国外的用户发起申请恶意退款，钱直接退了。找 PayPal 申请仲裁，直接判输………Paypal 说发货地址 和用户记录在 Paypal 的地址不一致，所以无法证实交易的真实性。
>
> （评论）如果对方是信用卡付的款，PP 判你赢也没用，对方银行做主，PP 做不了主。
>
> （评论）恶意退单了，paypal 还多扣 20 刀，我也是服了。

**English**:
> A foreign buyer filed a malicious refund and the money was simply returned. I escalated to PayPal arbitration and lost outright… PayPal said the shipping address didn't match the address on the buyer's PayPal record, so the authenticity of the transaction could not be verified.
>
> (comment) If the buyer paid by credit card, even winning at PayPal is useless — the buyer's bank decides, not PayPal.
>
> (comment) After the malicious chargeback, PayPal deducted an extra $20 on top. Unbelievable.

### 2 · Reddit r/freelance · ~2019 — 客户用争议流程夺回货款

**概括**：卖家按约定做了 500€ 的 logo 和 760€ 的网页应用设计，客户长时间使用其 Figma 源文件后发起 PayPal 争议，卖家账户随即变负 500€。口头约定的范围没有边界，"交付到什么程度算完成"全凭客户一张嘴。

**原文（English）**:
> "My client is about to scam me" — I have a client that want's to take back my money from the PayPal trough dispute process. We agreed on me making a logo for 500€, and a web app design for 760€…

**中文**：
> 标题：我的客户快要骗到我了。"我有个客户想通过 PayPal 的争议流程把我的钱拿回去。我们当初说好，我做 logo 收 500 欧元，网页应用设计收 760 欧元……"

### 3 · Reddit r/freelance · ~2019 — 文件交付后款项被划走

**概括**：数字文件交付完成后客户发起争议，PayPal 立即冻结并划走款项；卖家即使已提现也被强制要求退回。社区共识：无形商品没有卖家保障，只有实体物流单号才算送达证明。

**原文（English）**:
> "Task completed and files sent to client but paypal withdrew (held) the money?" — I got a task to do some digital files for a scammer skunk (it´s a she). … Long story short: I withdrew the money immediately, but now pp says I need to return money to my account so this scammer could get paid.

**中文**：
> 标题：任务完成、文件已发给客户，PayPal 却把（冻结并）划走了钱？"我接了个活，给一个骗子（是个女的）做数字文件。……长话短说：我立刻把钱提现了，但现在 PayPal 说我得把钱退回账户，好让这个骗子拿到退款。"

### 4 · Reddit r/freelanceWriters · 2020 — 分章交付仍被发起 $600 争议

**概括**：写手按约定分章交付（已交 2 章供审阅），客户仍发起 $600 的 PayPal 争议。模糊的口头范围（"写我的书"）让任何部分交付都可以被指为不达标，尾款部分成为争议杠杆。

**原文（English）**:
> "A client made a PayPal dispute for $600. What can I do to protect myself in the future?" — I was working on the project, delivered 2 chapters for review as agreed, when it turned out…

**中文**：
> 标题：客户发起了一笔 600 美元的 PayPal 争议。我以后该怎么保护自己？"我当时正在做这个项目，按约定交付了 2 章供审阅，结果……"

### 5 · Reddit r/freelance · ~2019 — 占理的卖家也要自己拼凑证据

**概括**：一位自认交付无误的卖家，完整记录了与"非常难缠的客户"打 PayPal 争议的过程：哪怕占理，也得自己东拼西凑 PayPal 表格认的证据。输赢取决于证据打包，而不取决于事实本身。

**原文（English）**:
> "Anyone ever have luck in a PayPal dispute as the seller?" — This is looooong but thank you for bearing with me if you can! I had a very difficult client…

**中文**：
> 标题：有没有人作为卖家在 PayPal 争议里赢过？"这篇很长，感谢你耐心看完！我之前遇到过一个非常难缠的客户……"

### 6 · V2EX · 2026-09-21 — 一次退款引发的投诉

**概括**：独立开发者（极简时钟 App）因未在数小时内处理微信退款申请，被用户投诉到市场监督管理局，接监管电话、写说明耗掉整周精力。非 PayPal 轨道同样存在"单方退款即升级为对抗"的不对称——ScopeGate 的价值与支付轨道无关。

**原文（中文）**：
> 周二接到了市场监督局的电话，说是有用户投诉我不给退款，这也是我第一次收到市场监督局的投诉通知。一番交流后，原来是上周六一个用户对极简时钟不满意，就在微信里申请了退款，但是我没有立刻回复和处理，这个用户就投诉到了市场监督局。

**English**:
> On Tuesday I got a call from the Market Regulation Bureau: a user had filed a complaint against me for refusing a refund — my first-ever complaint notice from them. It turned out that the previous Saturday, a user unhappy with my Minimal Clock app had requested a refund via WeChat; because I didn't reply and process it immediately, they complained to the bureau.

### 7 · Reddit r/Scams · ~2025 — 书面夸完作品，数周后抵赖"从未收到"

**概括**：数字画师交付后，客户在聊天里夸赞作品并经 WeTransfer 下载了文件；数周后退款被拒，客户向 Bank of America 发起信用卡拒付，谎称"从未收到产品"。卖家手握委托协议截图、收货确认聊天记录和下载记录，银行仍判买家赢——聊天截图不在裁判认可的证据类别里，等于零。

**原文（English）**:
> "Freelance scam from client and he got backed up by bank of america when I disputed with proof" — I'm posting this to warn fellow freelancers, especially digital … (the post quotes the client's pre-chargeback reply: "This looks amazing, I appreciate it", and the chargeback claim that the product was "never received").

**中文**：
> 标题：自由职业被客户骗了，我拿出证据申诉，美国银行却给客户撑腰。"发这个帖是为了提醒同行，尤其是数字……"（帖内引述客户拒付前的回复："这看起来太棒了，非常感谢！"——随后却以"从未收到产品"为由发起拒付。）

### 8 · Reddit r/personalfinance · 2020-11-17 — "收货后直接全额退款"的圈内骗局

**概括**：画师提问如何防"收到成品后悄悄全额退款"的买家，称这是艺术圈知名的潜规则。帖内高赞建议：给数字商品配一张带跟踪号的邮寄凭证，能赢下绝大多数"未收到"类拒付——本质是给裁判系统一个它认识的运单号。帖内另有人转述：某大型零售商连续五年被同一客户以"需签收的隔夜快递也称未收到"为由全额退款。

**原文（English）**:
> "As a growing online artists, how can i avoid buyers from simply refunding their payment on paypal after i send the final product?" — For a little context, its a little known thing within art communi9ties where there are some that commision digital art, will pay for it but after they receieve the product they simply issue a full refund without the artists knowing meaning they kinda get off with free art and the artists loses out.
>
> (top advice in thread) Digital goods accompanied by a tracking-certified receipt will win 99% of chargebacks as long as you actually respond.

**中文**（原文错别字按原样保留）：
> 标题：作为一个成长中的网络画师，我怎么才能避免买家在收到成品后直接在 PayPal 上全额退款？"先交代下背景：艺术圈里有个不太为人知的现象——有些人定制数字画，付了钱，但收到成品后悄悄发起全额退款，画师蒙受损失，他们等于白嫖。我只碰到过一次，但不知道怎么防范。求帮忙。"
>
> （帖内高赞建议）数字商品只要配上一张带跟踪号的邮寄凭证，只要你真的去应诉，就能赢下 99% 的拒付。

### 9 · Reddit r/stripe · ~2026 — 银行默认站持卡人一边

**概括**：数字代理公司与软件创始人反映：即使握有完整 Slack/邮件记录和签署的 SOW，"未收到服务"类争议仍然常输——银行默认判给持卡人。证明"交付后抵赖"横跨卡组织轨道，不是 PayPal 特有。

**原文（English）**:
> "Anyone else losing "Services Not Received" disputes despite having full Slack/Email receipts?" — I'm researching payment disputes for digital agencies and s…

**中文**：
> 标题：有没有人也在输"未收到服务"争议——明明握有完整的 Slack/邮件收据？"我在调研数字代理公司和……的支付争议……"

### 10 · LinkedIn（Upwork 卖家圈）· ~2025–2026 — 当天打 5 星，转天拒付

**概括**：Upwork 卖家圈多个独立发帖（2025–2026）描述同一模式：合同关闭当天买家亲手打了 5 星，随后发起拒付；卖家只能截图 5 星评分当证据。平台自己发的"确认收货"都挡不住抵赖——而 ScopeGate 的确认是哈希锚定的契约，不是一张截图。

**原文（English）**:
> "Client rated 5 stars the day the contract closed. Then filed a chargeback."

**中文**：
> "客户在合同关闭当天打了 5 星。然后发起了拒付。"

### 11 · Reddit r/paypal · ~2023 — 连环骗局与手工黑名单

**概括**：Discord 上接单的数字画师在交付一两个月后被买家拒付约 $200，最终败诉；标题本身就写着"digital art that they received"（他们收到手的数字画）。同一买家随后对另一位画师如法炮制，两位卖家账户双双负余额，买家被佣金 Discord 社区拉黑——今天的"防骗基础设施"就是这种口口相传的手工黑名单，ScopeGate 的哈希账本是它的机器可验证升级版。

**原文（English）**:
> "I am a seller. Customer filed a chargeback for digital art that they received a month or two ago. How can I resolve this issue?" — I am a digital artist that did work with someone on Discord. …

**中文**：
> 标题：我是卖家。客户对"他们一两个月前收到手的数字画"发起了拒付。我该怎么解决？"我是一名数字画师，和某人在 Discord 上有合作。……"
