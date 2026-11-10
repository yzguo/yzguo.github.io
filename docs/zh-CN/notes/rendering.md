---
title: Markdown 扩展示例
description: 在网站笔记中排版数学公式和 Mermaid 图表。
---

# Markdown 扩展示例

笔记支持标准 Markdown，也支持渲染数学公式和 Mermaid 图表。编写新 `.md` 文件时可以直接使用这些语法。

## 数学公式

行内公式使用单个美元符号，例如 $E = mc^2$。独立公式使用两个美元符号：

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

## 其他 Markdown

围栏代码块支持语法高亮；标题、表格、链接、图片和列表也都可以照常使用。
