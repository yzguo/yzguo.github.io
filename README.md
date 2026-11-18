# Yanzhen Guo — personal website

[简体中文](README.zh-CN.md) | **English**

This is a bilingual, Markdown-first personal website built with VitePress and published on GitHub Pages. This README is the single development entry point for setup, writing, page and feature changes, tools and AI, checks, security, and release.

- English: <https://yzguo.github.io/>
- Chinese: <https://yzguo.github.io/zh-cn/>

## Site architecture

The site is a static VitePress project: English content lives in `docs/`, the Chinese mirror lives in `docs/zh-cn/`, and GitHub Pages hosts the build. Every browser runtime asset is served from this site's own origin.

```text
.
├─ README.md
├─ README.zh-CN.md
├─ package.json
├─ ai-search.config.json
├─ docs/
│  ├─ index.md
│  ├─ About/
│  ├─ Projects/
│  ├─ Notes/
│  ├─ zh-cn/
│  ├─ public/
│  └─ .vitepress/
│     ├─ config.mts
│     ├─ shared.ts
│     ├─ en-us.ts
│     ├─ zh-cn.ts
│     ├─ head.ts
│     └─ theme/
├─ tools/
└─ .github/workflows/static.yml
```

`docs/Notes/` is the Notes section; its public URLs use the `/Notes/` prefix, and the Chinese mirror uses `/zh-cn/Notes/`. Old note URLs are not redirected, so old bookmarks and external links must be updated. `docs/.vitepress/config.mts` assembles the two locales, `en-us.ts` and `zh-cn.ts` own visible navigation, sidebars, and language-specific UI text, and `shared.ts` holds shared settings plus the Simplified Chinese local-search translations.

## Content and navigation

### Path mapping

Each English page lives at `docs/<path>`; its Chinese counterpart lives at `docs/zh-cn/<path>` and its public URL gains the `/zh-cn/` prefix.

| English | Chinese |
| --- | --- |
| `/` (`docs/index.md`) | `/zh-cn/` (`docs/zh-cn/index.md`) |
| `/About/` | `/zh-cn/About/` |
| `/Projects/` | `/zh-cn/Projects/` |
| `/Notes/` | `/zh-cn/Notes/` |
| `/Notes/<Category>/<page>` | `/zh-cn/Notes/<Category>/<page>` |

Notes currently has three categories: Courses, Learning, and Work. Each has an index page and a demo page, with the same entries and structure in both languages.

### Add or edit a page

Treat the Chinese page as the translation source and keep the same relative path, structure, and facts in both languages.

1. Add the Chinese Markdown under `docs/zh-cn/...`; add frontmatter only when needed.
2. Add the English counterpart under `docs/...`, or run `pnpm translate:docs:write` and review the result.
3. Link the page from its category index; for a new category or top-level section, update both locales' navigation and sidebars.
4. Run the relevant checks; keep headings, code blocks, tables, facts, numbers, and links equivalent.
5. Use `docs/Notes/` and `/Notes/` for Notes pages in both languages; do not add aliases, redirects, or duplicate pages for old note routes.
6. To delete a page, remove both language files in the same change, then remove its links from the category index and any navigation or sidebar; never delete user content without explicit authorization.

### Navigation and UI text

Visible text and link structure must have the same entry count and corresponding meaning in both languages; the Chinese interface must not contain English placeholder copy.

- `docs/.vitepress/en-us.ts`: English navigation, sidebars, and language-specific UI text; English local search uses the VitePress defaults.
- `docs/.vitepress/zh-cn.ts`: Chinese navigation, sidebars, and language-specific UI text; do not maintain search translations here.
- `docs/.vitepress/shared.ts`: settings shared by both languages plus the Simplified Chinese local-search translations for the button, modal, no-results text, and accessibility labels.
- `docs/index.md` and `docs/zh-cn/index.md`: matching hero actions and feature cards.
- Top-level entries, Notes categories, and page counts must be added or removed in both locales in the same change.

## Tools and AI

### Tool directory

All development tools live in `tools/`. Every former `scripts/` module has moved here under its original basename; there is no `scripts/` directory or compatibility shim, and you must not create a second tools directory. Public command names in `package.json` stay unchanged; only their entry points move to `tools/`.

- `tools/ai-model.mjs`: local model adapter with configuration validation, path restrictions, timeout, and error redaction.
- `tools/ai-search.mjs`, `tools/ai-search-config.mjs`: the dev-server AI search endpoint, public switch, and publish scan.
- `tools/check-bilingual.mjs`: bilingual structure checks and model-based semantic review.
- `tools/translate-docs.mjs`: translation CLI with its Markdown, Mermaid, privacy, and write-safety support modules.
- `tools/*.test.mjs`: behavior tests colocated with their implementation.
- `tools/model-config.yaml`: the ignored default private model configuration; only the local model adapter reads it at runtime for authentication. Humans and agents must not read, print, copy, or commit it.

These command names are a stable interface; do not rename them when changing internals:

```sh
pnpm check:bilingual
pnpm translate:docs
pnpm translate:docs:write
pnpm translate:docs:force
pnpm test:bilingual
pnpm test:tools
```

### Local AI search and the switch

AI search is an optional local development feature and never enters the static production site. Its only switch is the public, non-sensitive root file `ai-search.config.json`:

```json
{
  "enabled": false
}
```

Default `false`. To use it on this computer, change `enabled` to `true` and restart `pnpm docs:dev`. When enabled, questions and selected public page excerpts go to the configured model service; private blocks, HTML comments, drafts, and non-public pages are excluded from model input. The endpoint accepts loopback clients with a matching same-origin `Host`/`Origin` only; the UI offers Cancel, and errors and timeouts are shown explicitly.

The local adapter calls an OpenAI-compatible model API directly and requires no Oh My Pi (`omp`) executable or authentication gateway. `pnpm docs:build` resolves the switch to `false` no matter what the file says; the production bundle contains only the boolean `false` and no AI button, endpoint, adapter, configuration object, or credential. GitHub Pages is static hosting, so public AI would require a separate backend that protects credentials server-side and cannot be implemented by static pages alone.

The dev server's file allowlist is limited to `docs/`, `docs/public/`, and `node_modules/`; requests resolving to `tools/`, private configuration, `.env`, or outside those roots are rejected. The build scans publishable documentation and stops on private configuration or symlinks/junctions. These are defense-in-depth checks, not an absolute guarantee against a compromised local account or filesystem.

### Private model configuration

The local model adapter reads its private configuration from the git-ignored `tools/model-config.yaml` by default, or from a safe private YAML/JSON file supplied by `AI_MODEL_CONFIG` outside the repository or at an allowed ignored location. The format is YAML; a `.json` file is parsed as JSON. The placeholders below form a valid schema example and contain no real endpoint or credential:

```yaml
providers:
  local:
    baseUrl: "https://model.example/v1"
    api: openai-completions
    apiKey: "<your-api-key>"
    models:
      - id: "<model-id>"
        name: "<model-name>"
        contextWindow: 32768
        maxTokens: 4096
        input: [text]
```

`api` must be `openai-completions` or `openai-compatible`. `baseUrl` must use HTTPS except for a loopback HTTP URL, and must not contain credentials, a query, or a fragment. Each model needs a unique `id`; `contextWindow` and `maxTokens` are positive integers, `maxTokens` cannot exceed `contextWindow`, and `input` is a non-empty string array when present. `AI_MODEL` and `AI_MODEL_PROVIDER` select the configured model and provider; `AI_REQUEST_TIMEOUT_MS` defaults to `300000` milliseconds and must stay below the browser's 15-minute hard stop. Missing, unreadable, or invalid configuration fails closed, with no environment-key or OMP fallback.

Repository-internal configuration is accepted only at ignored private locations: `tools/model-config.yaml` (also `.yml` or `.json`), root `.env`/`.env.*` (except `.env.example`), `tools/.env*`, and ignored key-pattern files directly under `tools/` (`*.key`, `*.pem`, `*.secret.*`, `*.private.*`, `*.local.*`). `docs/` and other publishable or non-ignored repository paths are rejected. The previous default private configuration path is incompatible and has no compatibility shim; always use `tools/model-config.yaml` as the default. Old private-file patterns may remain ignored only to prevent accidental commits; being ignored does not make them supported configuration. Never commit private configuration, and never place secrets in tracked or publishable paths.

**Private-file rule:** `tools/model-config.yaml` is a real sensitive user file. Only the local model adapter may read it locally at runtime for authentication. Humans and agents must never read, print, copy, move, or commit it, and must never paste its contents into documentation, source, Actions, or an AI conversation; the adapter must not expose it.

## Local development

Node.js and pnpm are required (the version is pinned by `packageManager`). Install, develop, build, and preview:

```sh
pnpm install --frozen-lockfile
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```

`pnpm docs:dev` serves both languages. Markdown supports `$...$` inline math, `$$...$$` block math, and fenced `mermaid` diagrams; the course notes demo contains examples of all three. Fonts, formulas, and diagrams render locally and are not loaded from a CDN.

### Network requirements and offline limits

Every browser runtime asset is served from this site's own origin, with no CDN or third-party runtime requests. That is not the same as a fully offline application:

- Loading the deployed site requires a connection to its hosting server; `pnpm docs:dev` and `pnpm docs:preview` require a local server.
- The first `pnpm install` needs access to a package registry, and reinstalling without a populated store also needs the network.
- If the configured model provider is a remote API, AI search and model-backed checks need network access to that API. The adapter runs locally, but that does not make the model offline.

Do not describe the site or its AI features as fully offline, and do not add external runtime resources as a workaround for network restrictions.

## Assets, fonts, and rendering

Every browser runtime asset must be served from this origin. The CSP in `docs/.vitepress/head.ts` restricts resource sources; fonts live under `docs/public/fonts/` and images under `docs/public/images/`. Do not add CDNs, third-party fonts, or remote rendering services; the GitHub, QQ, Telegram, and Signal links on the About page are user-clicked external links, not runtime assets.

- Body: local Noto Sans SC covering both Chinese and Latin characters.
- Code: local Latin Modern Mono.
- Math: MathJax SVG from `markdown-it-mathjax3`.
- Diagrams: Mermaid loaded locally by `LocalMermaid.vue`.
- Symbols and emoji: Nerd Fonts, Noto Emoji, and Twemoji Mozilla.
- Licenses: font license files under `docs/public/fonts/` ship with the site.

Translation preserves code, formulas, and link targets; it translates Mermaid labels in flowcharts, sequence diagrams, and state diagrams under the safety rules, and fails without writing when a diagram cannot be handled safely.

## Checks and acceptance

The main check commands are:

| Command | Purpose |
| --- | --- |
| `pnpm check:bilingual` | Checks page structure, navigation/UI text, and translation semantics; calls the configured model. |
| `pnpm test:bilingual` | Behavior tests for translation, bilingual checks, privacy, paths, and write safety. |
| `pnpm test:tools` | Behavior tests for the AI adapter and AI search. |
| `pnpm docs:build` | Builds the production site at `docs/.vitepress/dist`. |

`pnpm check:bilingual` sends paired pages and UI text to the configured model; review its findings and do not treat them as proof of translation quality. GitHub Actions has no model credentials, so this check runs locally or during main verification only and is not part of the deployment workflow.

Manual acceptance covers at least: both languages' home pages and navigation, every sidebar and Notes entry, desktop and mobile widths, light and dark themes, math and Mermaid, font loading, and a production build with no AI and no non-site runtime requests.

- Report only commands actually run, their real output, and their coverage; never claim an unrun check passed.
- Never fabricate content, data, screenshots, or test results, and never hide failures, warnings, or known limitations.
- Never weaken privacy or security to pass a check, reduce bundle size, or speed up development, such as bypassing path validation, putting keys in the frontend, or adding external runtime services.
- Unless explicitly authorized, preserve existing public URLs, user content, and external links; do not rewrite personal facts. The note-section migration is an authorized exception, so old note routes are removed rather than preserved.

## Privacy and data safety

Public repositories must contain no credentials, private configuration, drafts, or unpublished personal data.

- `tools/model-config.yaml` must stay ignored and local-only. Only the local model adapter reads it at runtime for authentication; humans and agents must never read, print, copy, or commit it.
- `<!-- private:start -->` and `<!-- private:end -->` control model input only and do not change publishability; text inside them can still be exposed through Git or VitePress.
- HTML comments and private blocks are stripped from model input; do not use them to store keys, and never put keys in any Markdown.
- `ai-search.config.json` must contain only the public boolean switch; never add endpoints, keys, or other sensitive configuration.
- The translator validates results and checks conflicts before writing a batch; conflict checks are not a backup. Avoid editing target files concurrently; `translate:docs:force` overwrites existing English pages.
- The build rejects private files and symlinks/junctions in publishable paths; the dev server serves only allowlisted files. Fix the cause instead of disabling protection.

## Collaboration and file ownership

This repository may be developed by multiple agents in a shared worktree. Assign each independent feature to a separate subagent with an explicit file list and acceptance criteria; never give the same file to multiple agents at once.

- A subagent edits only its assigned files; ask the file's owner or the main agent before touching shared files, and never edit across scope.
- Do not reset, checkout, or overwrite user or other agents' changes; do not delete unrecognized user data. Keep `tools/model-config.yaml` local and ignored; only the local model adapter reads it at runtime, and humans or agents must not read, print, copy, or commit it.
- Subagents must not run build, test, lint, or format mid-flight; after all changes land, the main agent verifies once and reports real results.
- Split work into independently acceptable pieces; new features need behavior tests, colocated with their implementation under `tools/`.
- Update both READMEs when structure or commands change; this README is the single development entry, so do not create parallel development notes.
- Report blockers, risks, or decisions; do not substitute progress updates for actual completion.

## Deployment

Pushes to `main` trigger `.github/workflows/static.yml`, which installs dependencies, builds the site, and deploys `docs/.vitepress/dist` to GitHub Pages. The repository's Pages source must be set to **GitHub Actions**.

- The workflow only installs, builds, and deploys; it runs no model checks and holds no model credentials.
- Production builds always disable AI search even when `ai-search.config.json` is `true` on this computer.
- Before publishing, confirm checks passed, no private files are in the worktree, and no unreviewed translation overwrite remains.
- After deployment, spot-check both languages' pages, navigation, fonts, math, and diagrams; the site must not request non-site runtime resources.
