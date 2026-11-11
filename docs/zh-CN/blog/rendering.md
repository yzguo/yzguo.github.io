---
title: 数学与图表示例
description: 在博客文章中编写数学公式和 Mermaid 图表。
---

# 数学与图表示例

博客文章支持标准 Markdown，也支持数学公式和 Mermaid 图表。编写新 `.md` 文件时可以直接使用这些语法。

## 数学公式

行内公式使用 `$...$`，例如 $E = mc^2$。独立公式使用 `$$...$$`：

$$
\nabla \cdot \mathbf{E} = \frac{\rho}{\varepsilon_0}
$$

## Mermaid 图表

使用语言标记为 `mermaid` 的围栏代码块：

```mermaid
flowchart LR
    问题 --> 建模
    建模 --> 计算
    计算 --> 发现
    发现 --> 问题
```
