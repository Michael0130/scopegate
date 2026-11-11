---
name: alex-tailwind-theming
name_zh: alex-tailwind-theming
version: 1.0.0
description: >-
  Tailwind CSS 原子化样式系统，支持三端自适应与丝滑暗黑模式 (Dark Mode) 深度定制
---

# Alex · Tailwind 主题与响应式规范 (Tailwind Theming Rules)

## 1. 响应式与暗黑模式基准
- 三端视口精准适配：Mobile (<640px), Tablet (640-1024px), Desktop (>1024px)。
- 暗黑模式：基于 CSS 变量与 HTML class 无闪烁切换（flash-free SSR hydration）。
- 严格色彩语义化：背景色 `bg-background`、前景色 `text-foreground`、重点色 `brand-primary`。

## 2. 代码组织与约束
- 禁止使用任意行内 style，所有样式必须通过 Tailwind utility class 或 Tailwind config 语义化注入。
- 拒绝滥用外部 UI 组件库的冗余样式，纯手写轻量无污染组件。
