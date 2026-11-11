---
name: cj-payment-api-wiring
name_zh: 支付网关与 Webhook 管道接入技能
version: 1.0.0
description: >-
  Enterprise payment orchestration, seamless checkout wiring, robust webhook signature verification, and replay attack prevention.
triggers:
  - payment
  - api
  - checkout
  - webhook
  - stripe
  - paypal
  - wiring
  - gateway
  - 支付
  - 接口
  - 对账
  - 网关
  - 回调
---

# 业务技能规范：Payment Gateway & Webhook Wiring (CJ)

## 1. 核心交付基线
- 单一渠道支付接入（Checkout 订单创建 + 授权扣款流水）。
- Webhook 回调监听与 SHA-256 签名双向验真防重放。
- 沙盒环境端到端完整测试套件。

## 2. 硬性排除项 (One-Vote Veto)
- **严禁接**：第三方复杂黑盒风控建模（Custom payment risk modeling）。
- **严禁接**：SEO 优化与流量营销投放（SEO & growth marketing）。
- **严禁接**：历史遗留陈旧数据库无损迁移（Legacy data migration）。
