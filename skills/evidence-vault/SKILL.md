---
name: evidence-vault
name_zh: 履约存证与争议抗辩卷宗技能
version: 1.0.0
description: >-
  Fulfillment vault security, SHA-256 artifact hashing, download IP/UA access logging, and instant automated dispute dossier generation aligned with PayPal Seller Protection for Intangible Goods.
triggers:
  - delivery
  - download
  - vault
  - code
  - github
  - handover
  - dispute
  - refund
  - chargeback
  - evidence
  - dossier
  - 交付
  - 源码
  - 下载
  - 仓库
  - 争议
  - 退款
  - 抗辩
  - 证据
  - 卷宗
tools:
  - verify_delivery_hash
---

# 技能规范：Evidence Vault (履约存证与争议抗辩)

## 1. 核心定位
本技能为 ScopeGate 的履约存证与法务合规技能。通过对交付物物理哈希存证与下载审计日志追踪，在买家发起无理由退款或争议时秒级生成证据卷宗（Dossier），直连 PayPal 卖家保护。

## 2. 交付 Vault 安全红线
- 只有在首期款 (M1) 成功 Capture 后，才允许激活并下发 Vault 交付直链。
- 交付直链必须带有时间戳与签名防篡改。
- 买方每一次访问下载行为，必须严格记录客户端真实 IP、User-Agent、时间戳与交付物哈希。

## 3. PayPal 卖家保护对齐标准
- 争议抗辩证据必须直接援引 PayPal 官方账本中的 `custom_id` 契约哈希。
- 自动化组装证据包（Dossier），包含双方核准的客观条款、M1/M2 支付流水、交付物 SHA-256 及实际访问审计日志。
