---
name: paypal-settlement
name_zh: PayPal 分期结算与账本清算技能
version: 1.0.0
description: >-
  Deterministic ratcheting pricing engine, computes 40/60 milestone payment schedule, and anchors 64-character contract SHA-256 hash into PayPal custom_id ledger.
triggers:
  - price
  - pricing
  - quote
  - deposit
  - milestone
  - paypal
  - payment
  - split
  - billing
  - 多少钱
  - 价格
  - 报价
  - 定金
  - 首付
  - 分期
  - 支付
  - 结算
tools:
  - compute_quote
---

# 技能规范：PayPal Settlement (支付清算与分期阶梯)

## 1. 核心定位
本技能为 ScopeGate 的财务结算技能。彻底剥夺大模型自由算钱权，由确定性代码算法计算分期阶梯，并将契约哈希物理锚入 PayPal 官方账本。

## 2. 确定性棘轮单向计价 (One-Way Ratchet)
- 基础价格由商户基线（`base_price`）锁定。
- 价格只能在基准价格上单向增加（根据核准的 `surcharge_rules`），绝不允许大模型擅自降价或讨好客户打折。
- 任何未在商户基线规则表中声明的 rule 名称均被直接丢弃，不予计价。

## 3. 两阶段里程碑阶梯 (Two-Stage Milestones)
- **阶段一 (M1 定金 40%)**：项目启动定金（Kick-off Deposit），款项入账后方可开工与开放基础访问。
- **阶段二 (M2 尾款 60%)**：最终验收交付款（Balance on Final Handover），确认交付并获得完整源码资产。
- 两个阶段的金额之和严格等于总报价 `quoted_price`。

## 4. 账本锚定协议 (Ledger Fingerprinting)
- 将规范化（canonicalized）的合同条款计算为 64 位 SHA-256 哈希。
- 作为 PayPal 原生 `custom_id` 参数传入订单创建接口（格式 `${contract_hash}:${milestone_id}`）。
