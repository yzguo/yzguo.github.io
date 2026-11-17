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

Requires Node.js and pnpm:

```sh
pnpm install --frozen-lockfile
pnpm docs:dev
```

Local translation, bilingual checks, and AI search use the local model adapter in `tools/ai-model.mjs`. No Oh My Pi (`omp`) executable or authentication gateway is required.

Build and preview the production site with `pnpm docs:build` and `pnpm docs:preview`. Run `pnpm check:bilingual` to check page structure, navigation and interface labels, and the semantic consistency of translations. This sends the paired page and interface contents to the configured model; review its findings rather than treating them as proof of translation quality.

### AI search (local only)

AI search is controlled by one public, non-sensitive file, `ai-search.config.json`:

```json
{
  "enabled": false
}
```

The default is `false`. To use AI search on this computer, change `"enabled"` to `true` and restart `pnpm docs:dev`. When enabled, the AI button answers questions using public site content and the configured local model. Your question and selected public page excerpts are sent to that model service. Private blocks, HTML comments, drafts, and non-public pages are excluded. The endpoint accepts only loopback clients with matching same-origin `Host` and `Origin` headers, and a visible Cancel button stops a request.

`pnpm docs:build` always disables AI search, even if the config file says `true`. The production bundle contains only the resolved boolean `false`; it has no AI button, endpoint, model adapter, configuration object, or credential. GitHub Pages is static, so the published site retains ordinary local search and never calls a local or remote model. Enabling AI on the public site would require a separate secure backend that keeps credentials server-side; a static GitHub Pages deployment cannot do that by itself.

The development server's file allowlist is limited to `docs/`, `docs/public/`, and `node_modules/`. Requests that resolve to `tools/`, private model configuration, `.env` or key material, or outside these roots are rejected by the request guard, even when AI search is disabled. These are defense-in-depth checks, not a guarantee against a compromised local account or filesystem.

### Local model configuration

The local model adapter reads a git-ignored YAML file at `tools/api-key.txt`, or a private JSON/YAML file supplied with `AI_MODEL_CONFIG` in one of the allowed locations below. It expects:

```yaml
providers:
  local:
    baseUrl: "<provider-base-url>"
    api: openai-completions
    apiKey: "<local-secret>"
    models:
      - id: "<model-id>"
        name: "<model-name>"
        contextWindow: "<context-window-tokens>"
        maxTokens: "<max-output-tokens>"
        input: [text]
```

All angle-bracket values are placeholders, not claims about any specific service. In particular, `contextWindow` and `maxTokens` must be replaced with the integers reported by the provider/model actually configured; use the actual service as the source of truth.

`AI_MODEL_CONFIG` is resolved relative to the process working directory (normally the repository root). A path outside the repository is allowed. Inside the repository, the real path (including symlinks and junctions) is accepted only at:

- the default `tools/api-key.txt`;
- a directly contained file under `tools/` named `api-key.*`, `*.key`, `*.pem`, `*.secret.*`, `*.private.*`, `*.local.*`, or `.env*`;
- the repository root `.env` or `.env.*`, except `.env.example`.

Other repository paths are rejected by the configured validation. `docs/` (including `docs/public/`) is excluded, even if a symlink or junction resolves into it. The dev server rejects requests that resolve to these locations, and the production build scans documentation before publishing and stops when it detects the configured private files or symbolic links. These are defense-in-depth checks, not an absolute guarantee.

Context and output limits depend on the service, not just the model name. Public provider documentation and a relay endpoint can report different limits, so the adapter trusts the `contextWindow` and `maxTokens` declared in your local configuration and applies its own conservative prompt/output caps. For context only, DeepSeek's [public documentation](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) describes `deepseek-flash` as DeepSeek-V4.1-Flash-1017 with a 1M-token context and 384K maximum output; a relay's model metadata may expose only a maximum output value and no context window. The relay's actual context limit is not independently verified here, and those public numbers are not a guarantee for every endpoint or configuration.

`api` must be `openai-completions` (or `openai-compatible`). Do not commit the ignored file or paste a real endpoint or key into documentation, source, or GitHub Actions. `AI_MODEL` and `AI_MODEL_PROVIDER` select a configured model/provider. `AI_REQUEST_TIMEOUT_MS` sets the model timeout in milliseconds (default `300000`, i.e. 300 seconds); AI search passes the same integer timeout to the adapter, so a normal timeout produces an explicit error at 300 seconds. The browser also has a finite 15-minute hard stop for a hung dev server; keep `AI_REQUEST_TIMEOUT_MS` below that bound. It never waits indefinitely or hides the timeout. Missing, unreadable, or invalid configuration fails closed, with no environment-key or OMP fallback.

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

The translator and checker use the same local model adapter; no model configuration or credentials are copied into the repository or GitHub Actions. Text sent for translation or checking is transmitted to the configured model service. HTML comments and explicitly marked private blocks are excluded from model input. Both commands accept `--timeout <milliseconds>`; `pnpm check:bilingual` also accepts `--root <directory>`.

Mark a private block with `<!-- private:start -->` and `<!-- private:end -->`; an unclosed block causes the tools to fail rather than send its contents.

These markers only control model input: the marked text remains in the source and can be published through Git or VitePress. Never put credentials or unpublished private data in files intended for the public repository.

## Automatic deployment

Pushes to `main` run `.github/workflows/static.yml`, which builds the site and deploys `docs/.vitepress/dist` to GitHub Pages. Set the repository Pages source to **GitHub Actions**.

Markdown supports LaTeX math and Mermaid diagrams. The course notes demo includes examples. Fonts and rendering assets are served by the site rather than loaded from a CDN.

Both Chinese and Latin body text use the locally hosted Noto Sans SC. Code uses Latin Modern Mono, and math keeps MathJax's default SVG glyphs. Nerd Fonts provides symbol glyphs; standard emoji use the locally hosted Noto Emoji and Twemoji Mozilla fonts because Nerd Fonts does not cover them.
