---
title: Rich Markdown examples
description: Examples of mathematical notation and Mermaid diagrams in site notes.
---

# Rich Markdown examples

Notes support standard Markdown plus rendered mathematical expressions and Mermaid diagrams. You can use these directly in new `.md` files.

## Mathematics

Inline expressions use single dollar signs, such as $E = mc^2$. Display equations use double dollar signs:

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

## More Markdown

Fenced code blocks receive syntax highlighting. Ordinary headings, tables, links, images, and lists work as usual.
