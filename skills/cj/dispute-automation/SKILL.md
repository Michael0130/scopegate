---
name: cj-dispute-automation
name_zh: cj-dispute-automation
version: 1.0.0
description: >-
  PayPal 争议事件实时捕获、自动调取履约底账与生成法定抗辩证据包管线
---

# CJ · 争议自动化捕获与抗辩存证管线 (Dispute Automation Rules)

## 1. 争议事件捕获
- 监听 `PAYMENT.DISPUTE.CREATED` 与 `PAYMENT.DISPUTE.UPDATED` 官方 Webhook 事件。
- 毫秒级提取买家争议类型（INR 未收到货 / SNAD 与描述不符）。

## 2. 证据包直连组装
- 自动提取履约交付记录（买家 IP、下载 UA、时间戳、SHA-256 物理交付物哈希）。
- 组装 PayPal 卖家保护条例所规定的无形数字商品法定抗辩 Dossier，调用 Disputes API 一键提交。
