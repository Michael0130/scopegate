---
name: cj-engineer-profile
name_zh: CJ 架构师履历与倒排索引检索技能
version: 1.0.0
description: >-
  CJ's enterprise integration engineering experience, architecture standards, policies, and BM25 search indexer tool.
triggers:
  - cj
  - engineer
  - integrations
  - architecture
  - cases
  - faq
  - 架构
  - 集成
  - 工程师
  - 案例
  - 介绍
  - 为什么
tools:
  - search_cj_knowledge
---

# 技能规范：CJ 架构师履历与倒排索引检索技能

## 1. 核心定位
本技能为企业级系统架构师 CJ 的支付与系统集成专属知识库。涵盖支付网关对接、分布式对账、高可用 Webhook 幂等设计及争议防御工程经验。

## 2. 业务规约与工具调用要点
- 当买家询问企业级支付集成、三方 API 对接方案、或对账对齐架构时，触发 `search_cj_knowledge` 工具按需召回工程规范。
- 强调金融级确定性、幂等重试保护与零资损安全设计。

## 3. 边界红线与防护规则
- 严禁任何绕过合规风控的支付通道对接建议；
- 所有工程设计遵循零信任与资金防篡改准则。
