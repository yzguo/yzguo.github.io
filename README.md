# Yanzhen Guo — personal website

**English** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md)

A Markdown-first personal website built with VitePress and published on GitHub Pages. The site has English, Simplified Chinese, and Traditional Chinese editions with the same structure, facts, and content coverage. This README is the single development entry point for setup, writing, translation, configuration, checks, security, and release.

- English: <https://yzguo.github.io/en/>
- 简体中文: <https://yzguo.github.io/zh-cn/>
- 繁體中文: <https://yzguo.github.io/zh-tw/>
- Language entry (automatic selection): <https://yzguo.github.io/>

## Site architecture

The site is a static VitePress project. Each language edition lives in its own directory and is served from the matching public URL. Every browser runtime asset is served from this site's own origin.

```text
.
├─ README.md
├─ README.zh-CN.md
├─ README.zh-TW.md
├─ package.json
├─ config.json
├─ docs/
│  ├─ index.md
│  ├─ en/
│  ├─ zh-cn/
│  ├─ zh-tw/
│  ├─ public/
│  └─ .vitepress/
│     ├─ config.mts
│     ├─ shared.ts
│     ├─ en-us.ts
│     ├─ zh-cn.ts
│     ├─ zh-tw.ts
│     ├─ head.ts
│     └─ theme/
├─ tools/
└─ .github/workflows/static.yml
```

`docs/zh-cn/` is the translation source; `docs/en/` and `docs/zh-tw/` hold the English and Traditional Chinese editions at matching relative paths. `docs/index.md` is the root entry that opens the browser-preferred edition and holds no article content. `docs/.vitepress/config.mts` assembles the three locales; `en-us.ts`, `zh-cn.ts`, and `zh-tw.ts` own visible navigation, sidebars, and language-specific UI text; `shared.ts` holds settings shared by all editions and the local-search UI strings for `en`, `zh-cn`, and `zh-tw`.

## Language routing

The root URL opens the edition for the browser's preferred language:

- `zh-TW`, `zh-HK`, `zh-MO`, or `zh-Hant` → `/zh-tw/`
- any other `zh` language → `/zh-cn/`
- English and every other language → `/en/`

Automatic selection is client-side only and runs at the root, with no server redirect. If the browser reports no usable language preference or JavaScript is disabled, the site defaults to English. Visitors do not need to choose a language, and no language-selection page is shown. With JavaScript enabled, query strings and fragments are preserved; the no-JavaScript fallback does not preserve them. An explicit language path (`/en/`, `/zh-cn/`, `/zh-tw/`) and the language menu in the navigation remain available and are never overridden. Routing uses no external browser resource.

## Content and translation

Simplified Chinese is the translation source: `README.zh-CN.md` is the source for `README.md` and `README.zh-TW.md`, and `docs/zh-cn/` is the source for `docs/en/` and `docs/zh-tw/`.

### Path mapping

`/` is the language entry and opens the edition for the browser's preferred language (`docs/index.md`). Each content page exists once per edition, at the same relative path under `docs/en/`, `docs/zh-cn/`, or `docs/zh-tw/`, and its public URL uses the matching prefix.

| Section | Simplified Chinese (source) | English | Traditional Chinese |
| --- | --- | --- | --- |
| Home | `/zh-cn/` (`docs/zh-cn/index.md`) | `/en/` (`docs/en/index.md`) | `/zh-tw/` (`docs/zh-tw/index.md`) |
| About | `/zh-cn/About/` | `/en/About/` | `/zh-tw/About/` |
| Projects | `/zh-cn/Projects/` | `/en/Projects/` | `/zh-tw/Projects/` |
| Notes | `/zh-cn/Notes/` | `/en/Notes/` | `/zh-tw/Notes/` |
| Notes page | `/zh-cn/Notes/<Category>/<page>` | `/en/Notes/<Category>/<page>` | `/zh-tw/Notes/<Category>/<page>` |

Notes has three categories: Courses, Learning, and Work. Each has an index page and a demo page with the same entries and structure in all three editions.

### Add or edit a page

Keep the same relative path, heading structure, facts, math, code, and link semantics in all three editions.

1. Add or edit the Simplified Chinese Markdown under `docs/zh-cn/...`; add frontmatter only when needed.
2. Generate the English and Traditional Chinese counterparts with `pnpm translate:docs:write`, or edit them directly; review every generated target.
3. Link the page from its category index; for a new category or top-level section, update navigation and sidebars in all three locales.
4. Run the consistency checks; keep headings, code blocks, tables, facts, numbers, math, and link targets equivalent. Internal links use `/en/`, `/zh-cn/`, or `/zh-tw/` in their own edition.
5. To delete a page, remove its files from all three editions and all links in the same change; never delete user content without explicit authorization.

### Navigation and UI text

Visible text and link structure must have the same entry count and corresponding meaning in all three editions; no edition may contain placeholder copy.

- `docs/.vitepress/en-us.ts`: English navigation, sidebars, and language-specific UI text.
- `docs/.vitepress/zh-cn.ts`: Simplified Chinese navigation, sidebars, and language-specific UI text.
- `docs/.vitepress/zh-tw.ts`: Traditional Chinese navigation, sidebars, and language-specific UI text.
- `docs/.vitepress/shared.ts`: settings shared by all editions plus the local-search UI strings for `en`, `zh-cn`, and `zh-tw`; the English block matches the VitePress defaults.
- `docs/en/index.md`, `docs/zh-cn/index.md`, and `docs/zh-tw/index.md`: matching hero actions and feature cards.
- Top-level entries, Notes categories, and page counts must be added or removed in all three locales in the same change.

## Tools and configuration

All development tools live in `tools/`; do not create a second tools directory. The public command names in `package.json` are a stable interface and must not be renamed when internals change.

```sh
pnpm translate:docs
pnpm translate:docs:write
pnpm translate:docs:force
pnpm check:multilingual:structure
pnpm check:multilingual
pnpm test:multilingual
```

- `pnpm translate:docs`: read-only plan of the Simplified Chinese sources and their English and Traditional Chinese targets; writes nothing and calls no model.
- `pnpm translate:docs:write`: creates missing targets only. English pages are translated by the configured local model; Traditional Chinese pages are converted locally through OpenCC without network access; existing targets are never overwritten. Review every generated file.
- `pnpm translate:docs:force`: regenerates existing English and Traditional Chinese targets with the same rules and overwrites them.
- `pnpm check:multilingual:structure`: runs stage one only (equivalent CLI: `node tools/check-multilingual.mjs --structure-only`). It deterministically checks every page, README, and visible UI string in all three editions for complete language coverage, structure, code, math, Mermaid, links, and configuration, then exits without calling a model. It needs no model configuration, credentials, or network access.
- `pnpm check:multilingual`: runs both stages in order. Stage one must pass completely before stage two sends sanitized paired content to the configured model for semantic review. Any stage-one error means zero model requests.
- `pnpm test:multilingual`: behavior tests for translation, the two-stage multilingual check, privacy, paths, and write safety, including that a stage-one failure never calls the model.

The translation commands accept `-- --lang en|zh-tw` or `-- --only <path>` to narrow their scope. Translation preserves code, formulas, numbers, and URL targets; Mermaid labels in flowcharts, sequence diagrams, and state diagrams are translated under the safety rules, and a diagram that cannot be handled safely fails the run without writing.

- `tools/check-multilingual.mjs`: the two-stage multilingual checker.
- `tools/translate-docs.mjs`: the translation command-line entry point.
- `tools/document-model.mjs`, `tools/markdown-safety.mjs`, and `tools/semantic-safe.mjs`: document pairing and structure, Markdown privacy and write safety, and semantic-review projection.
- `tools/traditional-chinese.mjs` and `tools/mermaid-translate.mjs`: OpenCC conversion checks and safe Mermaid label translation.
- `tools/ai-model.mjs` and `tools/ai-search.mjs`: the local model adapter and the development-only AI search endpoint.
- `tools/site-config.mjs`: reads and validates the public root `config.json`; it never reads private model configuration.
- `tools/config.yaml`: the single default private tool configuration; only the local model adapter reads it at runtime for authentication and tool defaults.
- `tools/*.test.mjs`: behavior tests colocated with their implementation.

### Public site configuration

All optional site features are configured in one public, non-sensitive root file, `config.json`. It may contain only documented public switches; unknown fields are rejected, and it must never contain endpoints, credentials, tokens, or personal data.

```json
{
  "aiSearch": {
    "enabled": false
  },
  "performance": {
    "prefetchLinks": false
  }
}
```

AI search is an optional local development feature and never enters the static production site. It is disabled by default; to use it, set `aiSearch.enabled` to `true` and restart `pnpm docs:dev`. Questions and selected public page excerpts then go to the configured model service; private blocks, HTML comments, drafts, and non-public pages are excluded from model input. The endpoint accepts only loopback clients with a matching same-origin `Host`/`Origin`; the UI offers Cancel, and errors and timeouts are shown explicitly.

`performance.prefetchLinks` controls VitePress link prefetching. The default `false` avoids prefetching pages from other language editions on the first screen, keeping initial requests smaller. Setting it to `true` may make navigation faster, but it increases first-screen requests; enable it only when that trade-off is intended.

The adapter calls an OpenAI-compatible model API directly. `pnpm docs:build` resolves the switch to `false` regardless of the file, so the production bundle contains no AI button, endpoint, adapter, configuration object, or credential. GitHub Pages is static hosting; public AI would require a separate backend that protects credentials server-side. The dev server serves only `docs/`, `docs/public/`, and `node_modules/`, and the build rejects private files or symlinks/junctions in publishable paths. These are defense-in-depth checks, not an absolute guarantee against a compromised local account or filesystem.

### Private tool configuration

`tools/config.yaml` is the single default private configuration for the local tools. It is Git-ignored and local-only, and it is never served, bundled, or published. It holds both the model catalog and the tool defaults: the default provider, the default model, the request timeout, and the default output limit. There is no second per-tool configuration file inside the repository.

```yaml
# Default provider key from `providers` (optional; otherwise the built-in default when present, then the first).
provider: local
# Default model id (or display name) within that provider (optional; otherwise the first model).
model: example-model
# Model request timeout in milliseconds (optional; default 300000).
timeoutMs: 300000
# Default max output tokens per request (optional; default 16384).
maxOutputTokens: 16384

providers:
  local:
    baseUrl: "https://model.example/v1"
    api: openai-completions
    apiKey: "<your-api-key>"
    models:
      - id: example-model
        name: Example Model
        contextWindow: 32768
        maxTokens: 4096
        input: [text]
        # optional: reasoningEffort: none|low|medium|high|max|null (also allowed on the provider)
```

`provider` and `model` select the defaults; when they are absent, the adapter prefers its built-in default provider when configured, then the first provider, and uses the first model within that provider. `timeoutMs` and `maxOutputTokens` are optional positive integers with the defaults shown above. Per-run environment overrides are available: `AI_MODEL_CONFIG` points to an alternate private YAML/JSON file, `AI_MODEL` and `AI_MODEL_PROVIDER` select a model and provider, and `AI_REQUEST_TIMEOUT_MS` sets the timeout. A missing, unreadable, or invalid configuration fails closed.

`providers` maps a provider name to its settings. `api` must be `openai-completions` or `openai-compatible`. `baseUrl` must use HTTPS except for a loopback HTTP URL, and must not contain credentials, a query, or a fragment. Each model needs a unique `id`; `contextWindow` and `maxTokens` are positive integers when present, `maxTokens` cannot exceed `contextWindow`, and `input` is a non-empty string array when present. `reasoningEffort`, when used, is one of `none`, `low`, `medium`, `high`, `max`, or null.

**Private-file rule:** `tools/config.yaml` and any file named by `AI_MODEL_CONFIG` are real sensitive user configuration. Only the local model adapter may read them locally at runtime for authentication. Humans and agents must never read, print, copy, move, or commit them, and must never paste their contents into documentation, source, Actions, or an AI conversation; the adapter must not expose them. The alternate file must stay outside the repository or at an ignored private location, never in `docs/` or another publishable path. Never overwrite an existing private configuration with placeholder values.

## Local development

Node.js and pnpm are required (the pnpm version is pinned by `packageManager`). Install, develop, build, and preview:

```sh
pnpm install --frozen-lockfile
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```

`pnpm docs:dev` serves all three editions, including the root entry. Markdown supports `$...$` inline math, `$$...$$` block math, and fenced `mermaid` diagrams; the course notes demo contains examples of all three. Fonts, formulas, and diagrams render locally and are not loaded from a CDN.

### Network requirements and offline limits

Every browser runtime asset is served from this site's own origin, with no CDN or third-party runtime requests. That is not the same as a fully offline application:

- Loading the deployed site requires a connection to its hosting server; `pnpm docs:dev` and `pnpm docs:preview` require a local server.
- The first `pnpm install` needs access to a package registry, and reinstalling without a populated store also needs the network.
- If the configured model provider is a remote API, AI search, English translation, and model-backed checks need network access to that API. The adapter runs locally, but that does not make the model offline.

Network transfer time depends on the visitor's connection and the hosting service; the site does not guarantee any page load time or per-resource latency.

Do not describe the site or its AI features as fully offline, and do not add external runtime resources as a workaround for network restrictions.

## Assets, fonts, and rendering

Every browser runtime asset must be served from this origin. The CSP in `docs/.vitepress/head.ts` restricts resource sources; fonts live under `docs/public/fonts/` and images under `docs/public/images/`. The site uses local Noto Sans SC for body text, Latin Modern Mono for code, MathJax SVG from `markdown-it-mathjax3` for math, locally loaded Mermaid for diagrams, and Nerd Fonts, Noto Emoji, and Twemoji Mozilla for symbols. Font licenses ship under `docs/public/fonts/`. Do not add CDNs, third-party fonts, or remote rendering services; the GitHub, QQ, Telegram, and Signal links on the About page are user-clicked external links, not runtime assets.

Translation preserves code, formulas, and link targets; it translates Mermaid labels in flowcharts, sequence diagrams, and state diagrams under the safety rules, and fails without writing when a diagram cannot be handled safely.

## Checks and acceptance

The main check commands are:

| Command | Purpose |
| --- | --- |
| `pnpm check:multilingual:structure` | Stage-one deterministic checks only: complete language coverage, page and README structure, code, math, Mermaid, links, Traditional Chinese conversion, and UI text. No model configuration or credentials needed. |
| `pnpm check:multilingual` | Both stages: stage one must pass completely before stage two may call the model for semantic review. Any stage-one error means zero model requests. |
| `pnpm test:multilingual` | Behavior tests for translation, the two-stage multilingual check, privacy, paths, and write safety. |
| `pnpm docs:build` | Builds the production site at `docs/.vitepress/dist`. |

Stage one enumerates the three document trees, the root README trio, other supported root Chinese documents, and the visible UI strings loaded from `en-us.ts`, `zh-cn.ts`, and `zh-tw.ts`. It checks paths, heading sequence, paragraph, list, and blockquote shapes, tables, code fences, math, Mermaid structure, link targets and locale prefixes, untranslated Traditional Chinese text, navigation, sidebars, frontmatter, protected content, and configuration, and it collects every error instead of stopping at the first. Unreadable files, privacy failures, and configuration failures also count as stage-one errors. `docs/index.md` is the root entry and is not paired.

Stage two runs only when stage one has no errors. It sends sanitized paired page content and UI text to the configured model for a per-page semantic review, and a semantic failure is returned as a non-zero result. Model output is a review aid, not proof of translation quality; read the findings and do not treat a semantic failure as a pass. The full command needs a working private model configuration, while `pnpm check:multilingual:structure` needs neither credentials nor network access.

Manual acceptance covers at least: the three editions' home pages, navigation, sidebars, and Notes entries; automatic root selection for Traditional Chinese, other Chinese, and English or other languages; English as the root fallback when JavaScript is disabled or no language is reported; explicit language paths and the navigation language menu remaining in effect; desktop and mobile widths; light and dark themes; math and Mermaid; font loading; and a production build with no AI and no non-site runtime requests.

Cold-cache acceptance is a goal, not a guarantee: first loading each edition's resources in a fresh, cacheless browser should take under 1 second where the visitor's network, GitHub Pages, and browser conditions allow. After a deployment, wait for the CI/CD workflow to finish, then test the live site in a new browser profile with an empty cache (or with caching disabled) and report the real measurements and conditions. Never fabricate, cherry-pick, or hide timings.

- Report only commands actually run, their real output, and their coverage; never claim an unrun check passed.
- Never fabricate content, data, screenshots, or test results, and never hide failures, warnings, or known limitations.
- Never weaken privacy or security to pass a check, reduce bundle size, or speed up development, such as bypassing path validation, putting keys in the frontend, or adding external runtime services.
- Unless explicitly authorized, preserve existing public URLs, user content, and external links; do not rewrite personal facts.

## Privacy and data safety

Public repositories must contain no credentials, private configuration, drafts, or unpublished personal data.

- Root `config.json` may contain only public, non-sensitive switches. Never add endpoints, keys, tokens, or private provider settings; unknown fields are rejected.
- `tools/config.yaml` must stay ignored and local-only. Only the local model adapter reads it at runtime for authentication; humans and agents must never read, print, copy, or commit it.
- Private block markers `<!-- private:start -->` and `<!-- private:end -->` control model input only and do not change publishability; text inside them can still be exposed through Git or VitePress.
- HTML comments and private blocks are stripped from model input; do not use them to store keys, and never put keys in any Markdown.
- The translator validates results and checks conflicts before writing a batch; conflict checks are not a backup. Avoid editing target files concurrently; `translate:docs:force` overwrites existing English and Traditional Chinese pages.
- The build rejects private files and symlinks/junctions in publishable paths; the dev server serves only allowlisted files. Fix the cause instead of disabling protection.

## Collaboration and file ownership

This repository may be developed by multiple agents in a shared worktree. Assign each independent feature to a separate subagent with an explicit file list and acceptance criteria; never give the same file to multiple agents at once.

- A subagent edits only its assigned files; ask the file's owner or the main agent before touching shared files, and never edit across scope.
- Do not reset, checkout, or overwrite user or other agents' changes; do not delete unrecognized user data. Keep `tools/config.yaml` local and ignored; only the local model adapter reads it at runtime, and humans or agents must not read, print, copy, or commit it.
- Subagents must not run build, test, lint, or format mid-flight; after all changes land, the main agent verifies once and reports real results.
- Split work into independently acceptable pieces; new features need behavior tests, colocated with their implementation under `tools/`.
- Update all three READMEs when structure or commands change; this README is the single development entry, so do not create parallel development notes.
- Report blockers, risks, or decisions; do not substitute progress updates for actual completion.

## Deployment

Pushes to `main` trigger `.github/workflows/static.yml`, which installs dependencies, builds the site, and deploys `docs/.vitepress/dist` to GitHub Pages. The repository's Pages source must be set to **GitHub Actions**.

- The workflow only installs, builds, and deploys; it runs no model checks and holds no model credentials.
- Production builds always disable AI search even when `config.json` is `true` on this computer.
- Before publishing, confirm checks passed, no private files are in the worktree, and no unreviewed translation overwrite remains.
- After deployment, wait for the workflow to complete, then spot-check the three editions' pages, navigation, fonts, math, and diagrams; the site must not request non-site runtime resources.
- Then run the cold-cache test in a fresh browser profile with an empty cache and report the actual results; do not promise or fake a fixed load time.
