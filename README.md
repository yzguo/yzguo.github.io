# Yanzhen Guo — personal website

A bilingual Markdown-first personal website built with VitePress and deployed to GitHub Pages.

- English site: <https://yzguo.github.io/>
- 简体中文: <https://yzguo.github.io/zh-cn/>

## Content layout

- `docs/About/` and `docs/zh-cn/About/` — biography and education.
- `docs/Projects/` and `docs/zh-cn/Projects/` — project index and pages.
- `docs/Blogs/` and `docs/zh-cn/Blogs/` — course, learning, and work notes.

The Blogs section has separate `Courses/`, `Learning/`, and `Work/` folders. Each category contains an index and a demo page. Copy a demo Markdown page, add it to the category index, and replace its example prompts with your content. Create further subfolders whenever a category grows.

English pages live under `docs/`; their Simplified Chinese counterparts live at the same paths under `docs/zh-cn/`. Keep the paired pages in sync when adding content.

## Local development

Requires Node.js and pnpm:

```sh
pnpm install --frozen-lockfile
pnpm docs:dev
```

Build and preview the production site with `pnpm docs:build` and `pnpm docs:preview`.

## Deployment

Pushes to `main` run `.github/workflows/static.yml`, which builds the site and deploys `docs/.vitepress/dist` to GitHub Pages. Set the repository Pages source to **GitHub Actions**.

Markdown supports LaTeX math and Mermaid diagrams. See the blog demo pages for examples.
