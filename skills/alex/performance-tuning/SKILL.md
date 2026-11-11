---
name: alex-performance-tuning
name_zh: alex-performance-tuning
version: 1.0.0
description: >-
  Lighthouse 95+ 核心性能基准调优，亚秒级 Edge Runtime 首屏响应，CLS 视觉稳定性保障
---

# Alex · 核心性能调优规则 (Performance Tuning Rules)

## 1. 核心技术指标
- **Lighthouse Score**: 综合 95+ 分（Performance, Accessibility, Best Practices, SEO）。
- **LCP (Largest Contentful Paint)**: < 1.2 秒。
- **FID (First Input Delay) / INP (Interaction to Next Paint)**: < 100 毫秒。
- **CLS (Cumulative Layout Shift)**: < 0.05 极致视觉稳定性。

## 2. 交付与优化规范
- 图片全面采用 Next.js Image 组件，自动转换为 WebP/AVIF 格式并配置渐进式占位。
- 采用 React Server Components (RSC) 零打包体积原则，交互组件精准使用 `'use client'`。
- 字体文件本地子集化（next/font），消除字体加载布局抖动与外部网络阻塞。
