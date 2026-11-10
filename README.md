# Yanzhen Guo — personal website

Markdown-first personal site built with [VitePress](https://vitepress.dev/) and published at <https://yzguo.github.io/>.

## Write content

English pages live in `docs/`; Chinese translations live in `docs/zh-CN/`. Keep corresponding pages in sync when publishing updates.

| Section | English | 中文 |
| --- | --- | --- |
| Home | `docs/index.md` | `docs/zh-CN/index.md` |
| About | `docs/about.md` | `docs/zh-CN/about.md` |
| Projects | `docs/projects.md` | `docs/zh-CN/projects.md` |
| Notes | `docs/notes/` | `docs/zh-CN/notes/` |

Create Markdown files under the relevant directory and link them from its index. The appearance follows the operating system by default; visitors can switch between light and dark themes.

## Math and diagrams

Use LaTeX math delimiters (`$...$` inline, `$$...$$` display) and fenced `mermaid` code blocks. See Notes → Rich Markdown examples for working samples.

## Preview locally

Requires Node.js 20+ and Corepack:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm docs:dev
```

Build the static site with `corepack pnpm docs:build`.

Check that English and Chinese pages stay paired and retain matching Markdown structure with `corepack pnpm check:bilingual`. The same check runs in CI before each build.

## Automatic deployment

Every push to `main` runs `.github/workflows/deploy.yml` and publishes the built site to GitHub Pages. Set Repository → Settings → Pages → Build and deployment → Source to **GitHub Actions**. The workflow uses `GITHUB_TOKEN`; no deploy secret is required.
