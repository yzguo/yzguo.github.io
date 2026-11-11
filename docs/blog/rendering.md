---
title: Math and diagram examples
description: Writing mathematics and Mermaid diagrams in blog posts.
---

# Math and diagram examples

Blog posts support standard Markdown plus rendered mathematical expressions and Mermaid diagrams. Use these directly in new `.md` files.

## Mathematics

Inline math uses `$...$`, such as $E = mc^2$. Display equations use `$$...$$`:

$$
\nabla \cdot \mathbf{E} = \frac{\rho}{\varepsilon_0}
$$

## Mermaid diagrams

Use a fenced code block marked `mermaid`:

```mermaid
flowchart LR
    Question --> Model
    Model --> Compute
    Compute --> Insight
    Insight --> Question
```
