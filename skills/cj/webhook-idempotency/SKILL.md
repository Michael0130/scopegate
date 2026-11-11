---
name: cj-webhook-idempotency
name_zh: cj-webhook-idempotency
version: 1.0.0
description: >-
  PayPal Webhook 事件幂等性消费架构、消息去重与指数退避重试管道
---

# CJ · Webhook 幂等消费与容灾重试规范 (Webhook Idempotency Rules)

## 1. 幂等性控制
- 提取 PayPal Webhook Header 中的 `correlation-id` 与载荷 `id` 作为联合幂等主键。
- 采用强一致性原子写入锁，毫秒级防止重复事件并发消费。

## 2. 重试与告警管道
- 消费失败执行指数退避重试（1s, 5s, 30s, 5m）。
- 连续 3 次失败推入死信队列 (DLQ) 并触发紧急运维告警。
