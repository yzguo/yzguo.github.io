# Yanzhen Guo — personal website

A bilingual Markdown-first personal website built with VitePress and deployed to GitHub Pages.

- English site: <https://yzguo.github.io/>
- 简体中文: <https://yzguo.github.io/zh-cn/>

## Content layout

- `docs/About/` and `docs/zh-cn/About/` — biography and education.
- `docs/Projects/` and `docs/zh-cn/Projects/` — project index and pages.
- `docs/Blogs/` and `docs/zh-cn/Blogs/` — course, learning, and work notes.

The Blogs section has separate `Courses/`, `Learning/`, and `Work/` folders. Each category contains an index and a sample article. Copy a sample Markdown page, replace its contents with your own notes, and add it to the category index. Create further subfolders whenever a category grows.

Write the Chinese pages under `docs/zh-cn/`; their English counterparts live at the same paths under `docs/`. The local translation tool uses the Chinese pages as its source.

## Local development

Requires Node.js, pnpm, and Oh My Pi (`omp`) configured with the `ustc/deepseek-flash` model for local translation, bilingual checks, and AI search:

```sh
pnpm install --frozen-lockfile
pnpm docs:dev
```

Build and preview the production site with `pnpm docs:build` and `pnpm docs:preview`. Run `pnpm check:bilingual` to check page structure, navigation and interface labels, and the semantic consistency of translations. This sends the paired page and interface contents to the configured model; review its findings rather than treating them as proof of translation quality.

While `pnpm docs:dev` is running on this computer, the AI search button answers questions using local site content and the configured Oh My Pi model. Your question and relevant public page excerpts are sent to the model service. The AI endpoint is limited to this computer; the published site retains ordinary local search and does not receive your model credentials.

## Local translation

```sh
pnpm translate:docs
pnpm translate:docs:write
pnpm translate:docs:force
pnpm check:bilingual
```

The first command lists Chinese sources and their English targets without writing or calling the model. The second creates missing English files; the third explicitly overwrites existing English files, so review the changes carefully. The final command checks the bilingual pages and interface. The translator validates every generated file before writing the batch. Avoid editing target files concurrently; conflict checks are not a substitute for a backup.

The tool also maps `README.zh-CN.md` to `README.md` and root Markdown files with Chinese names to matching `.en.md` files. It does not treat English files containing Chinese names as Chinese sources.

Program code, formulas, and link targets are preserved. Mermaid labels are translated for flowcharts, sequence diagrams, and state diagrams; diagrams that cannot be safely translated cause an error instead of being written. Review generated translations before publishing.

The tools use the local Oh My Pi authentication gateway; no model configuration or credentials are copied into the repository or GitHub Actions. Text sent for translation or checking is transmitted to the configured model service. HTML comments and explicitly marked private blocks are excluded from model input.

Mark a private block with `<!-- private:start -->` and `<!-- private:end -->`; an unclosed block causes the tools to fail rather than send its contents.

These markers only control model input: the marked text remains in the source and can be published through Git or VitePress. Never put credentials or unpublished private data in files intended for the public repository.

## Automatic deployment

Pushes to `main` run `.github/workflows/static.yml`, which builds the site and deploys `docs/.vitepress/dist` to GitHub Pages. Set the repository Pages source to **GitHub Actions**.

Markdown supports LaTeX math and Mermaid diagrams. The course notes demo includes examples. Fonts and rendering assets are served by the site rather than loaded from a CDN.

Chinese text uses Noto Sans SC, Latin text uses Latin Modern, and math keeps MathJax's default glyphs. Nerd Fonts provides symbol glyphs; standard emoji use the locally hosted Noto Emoji and Twemoji Mozilla fonts because Nerd Fonts does not cover them.
