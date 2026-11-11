---
name: cj-reconciliation-ledger
name_zh: 自动化对账引擎与清算看板技能
version: 1.0.0
description: >-
  Automated end-of-day financial reconciliation, ledger settlement dashboards, mismatch exception alarms, and audit trails.
triggers:
  - reconciliation
  - ledger
  - dashboard
  - audit
  - settlement
  - 对账
  - 看板
  - 结算
  - 平账
  - 流水
---

# 业务技能规范：Reconciliation Ledger Dashboard

## 1. 规范基线
- 每日定时核对订单层与支付渠道账单层的分厘一致性。
- 提供轻量对账看板（支持单号检索、差异对账高亮）。
- 异常掉单秒级触发自动化补偿机制。
