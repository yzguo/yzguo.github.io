# Yanzhen Guo — personal website

**English** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md)

A Markdown-first personal website built with VitePress and published on GitHub Pages. It has English, Simplified Chinese, and Traditional Chinese editions with matching structure, facts, and content coverage. Write only Simplified Chinese under `docs/zh-cn/`; `pnpm content:sync` generates the English and Traditional Chinese editions, and navigation and sidebars are generated automatically from the content tree. Do not maintain three copies by hand.

- English: <https://yzguo.github.io/en/>
- 简体中文: <https://yzguo.github.io/zh-cn/>
- 繁體中文: <https://yzguo.github.io/zh-tw/>
- Language entry (automatic selection): <https://yzguo.github.io/>

## Quick start

Node.js and pnpm are required; the pnpm version is pinned by `packageManager`.

```sh
pnpm install --frozen-lockfile
pnpm content:sync
pnpm docs:dev
```

`content:sync` needs the private model configuration described below. When everything is already in sync it makes no model calls and leaves files unchanged.

## Writing only Simplified Chinese

Workflow: edit one Chinese page, run `pnpm content:sync`, preview with `pnpm docs:dev`, then commit the Chinese source, both generated editions, and the state manifest.

`docs/zh-cn/` is the source of truth. Every page is mapped by relative path to `docs/en/` and `docs/zh-tw/` and to the matching public URL:

| Source | English | Traditional Chinese |
| --- | --- | --- |
| `docs/zh-cn/Notes/Courses/demo.md` | `docs/en/Notes/Courses/demo.md` | `docs/zh-tw/Notes/Courses/demo.md` |
| `/zh-cn/Notes/Courses/demo` | `/en/Notes/Courses/demo` | `/zh-tw/Notes/Courses/demo` |

### Directories and index pages

- Put each page in the directory where it belongs. A directory that readers should browse as a section needs an `index.md` landing page. Directory URLs end with `/`; page URLs omit `.md`.
- If a directory contains Markdown but no `index.md`, `content:sync` creates a minimal Chinese index and its two translations. An existing `index.md` is never overwritten, and you may edit its title and introduction.
- An entry appears in the navigation and lists only when its Chinese, English, and Traditional Chinese pages all exist, are readable, and are not marked `draft: true` or `private: true`. Otherwise all three editions hide it.

### File names and headings

- File and directory names become public URLs. Use short, stable ASCII names without spaces; lowercase words joined by hyphens are the safest choice. Names starting with `.` are excluded, and `index.md` is reserved for directory landing pages.
- Navigation and page titles come from the YAML `title` in frontmatter, then from the first visible H1 (ignoring HTML comments, private blocks, and code fences), then from the path name.
- Give every page one clear H1 at the top. Renaming a file or directory changes its public URL, so prefer keeping published names stable.
- An optional numeric `order` in frontmatter sorts entries (smaller first); entries without it follow relative-path order. About, Projects, and Notes keep their current top-level order, and new top-level sections follow Notes.

### Content and links

- Write normal VitePress Markdown. Use `/zh-cn/...` for internal links in the source; generated editions receive the corresponding `/en/...` and `/zh-tw/...` links.
- Code blocks, inline code, formulas, numbers, frontmatter, URLs, and Mermaid structure are preserved during translation. Mermaid labels visible to readers are translated under the safety rules.
- Notes index pages use `<NotesIndex />` to list child pages automatically with titles and short summaries (frontmatter `description` or the first paragraph). Keep the component and the introduction text; do not add manual entry links. New pages and categories need no TypeScript or index-list edits: restart `pnpm docs:dev` or rebuild to refresh navigation and sidebars; Notes lists also update live in development.
- Mark a page `draft: true` or `private: true` to hide it from navigation and lists; marking a section's `index.md` hides its whole subtree. These flags only affect navigation and lists, not Git or the VitePress build, so never put secrets or truly private content in `docs/`. Untranslated, unreadable, or invalid-YAML pages are also omitted from navigation.
- Do not edit `docs/en/`, `docs/zh-tw/`, or `docs/.vitepress/navigation.*`. Change the Chinese source and run `content:sync` again.

## What `content:sync` does

- Translates new or changed Simplified Chinese pages into both English and Traditional Chinese with the configured model. Both editions are real AI translations; OpenCC only assists with Traditional Chinese script correction.
- Records a committed `tools/content-sync-state.json` (version 1) for `docs/zh-cn` pages (not the root READMEs) with SHA-256 content hashes, so unchanged sources skip model calls. The manifest contains only paths, hashes, and an auto-index marker, never page content or credentials.
- Updates a target only when it was generated by the tool and its hash still matches the recorded baseline. A hand-edited target, a target with no trusted baseline, or a concurrent change is refused and reported with exit code 1; nothing is silently overwritten. To recover, restore the target from version control (or delete it and rerun) and sync again; do not hand-merge generated pages.
- If the manifest is missing, the tool first builds a baseline for existing complete trilingual pages by hashing them, without reading the model configuration or calling a model. Commit that baseline. If you delete it later, the current target content becomes the new baseline, so earlier manual edits are no longer detected.
- Creates missing `index.md` files for content directories under `docs/zh-cn/` (except the root). Notes directories get a dynamic `<NotesIndex />` page; other directories get a minimal `# <directory name>` link list. An auto-created index refreshes and is translated again when pages are added or removed in its directory. Once you hand-edit an auto-created index, it becomes an ordinary source and is no longer rewritten automatically. An index that existed before the tool ran is never overwritten.
- For each generated target: model translation, then structure/safety validation, then model semantic review. Any failure aborts the whole run before writing. This is a per-target check, not the site-wide two-stage review.
- After all targets pass, writes target pages and the state manifest in one atomic batch, with the manifest last. A write failure is rolled back and reported. A crash inside the narrow check-to-rename window is reported as a conflict on the next run rather than overwritten.
- Exits `0` when everything is in sync or updated, `1` for a conflict, generation, semantic, or write failure, and `2` for invalid arguments.

Pass options after `--`, for example `pnpm content:sync -- --dry-run`. Useful options: `--dry-run` (plan without model calls or writes), `--only <source-or-target-path>` (repeatable), `--lang en|zh-tw` (repeatable; only the selected editions are processed and marked), `--init` (build the baseline for existing complete trilingual pages; refuses if a manifest exists), `--root <dir>` (isolated root), `--timeout <ms>`, and `--help`.

## Sensitive content and the model boundary

`content:sync` sends sanitized Simplified Chinese source text to the configured model service. If that provider is remote, the page content leaves this computer.

- HTML comments and explicit private blocks (`<!-- private:start -->` … `<!-- private:end -->`) are removed before model input and are not written to generated editions.
- Private markers are not access control. Text under `docs/zh-cn/` is still in Git and is published on the Chinese site; use them only to keep content out of model input and translated pages.
- Optional AI search runs only on the local development server. It sends the question and selected public page excerpts to the configured model; pages marked `draft: true` or `private: true`, HTML comments, private blocks, and non-public files are excluded. The endpoint accepts only loopback clients with matching same-origin `Host`/`Origin` headers, and credentials stay on the local server.
- Never put API keys, tokens, passwords, or private configuration in Markdown, `config.json`, source code, Actions, or a model conversation.
- `tools/config.yaml` is the local private model configuration. Only the local model adapter reads it at runtime. Humans and agents must never read, print, copy, move, or commit it, and must never replace it with placeholder values.
- The production site contains no AI endpoint, adapter, configuration object, or credential. AI search is a local development feature only, and the build rejects private files or symlinks in publishable paths.

## Configuration

Public, non-sensitive switches live in the root `config.json`:

```json
{
  "aiSearch": false,
  "prefetchLinks": false
}
```

Both switches are optional and default to `false`; unknown fields and non-boolean values are rejected. `aiSearch` enables the local development AI search and is always disabled in production builds. `prefetchLinks` controls VitePress link prefetching.

The private model configuration is `tools/config.yaml`: Git-ignored, outside `docs/` and any publishable path, never served or bundled. The minimal form is:

```yaml
baseUrl: "https://model.example/v1"
apiKey: "<API_KEY>"
model: "<MODEL_ID>"
```

Only `baseUrl`, `apiKey`, and `model` are required. Optional fields and defaults: `api` (`openai-completions`), `timeoutMs` (`300000`), `maxOutputTokens` (`16384`), and `reasoningEffort` (`none`). `baseUrl` must use HTTPS except for a loopback HTTP address, must not contain credentials, a query, or a fragment, and has no implicit default, so credentials cannot be sent to an unintended service. The API defaults to OpenAI-compatible chat completions. Advanced single-provider model catalogs and the existing multi-provider form remain supported. `AI_MODEL`, `AI_MODEL_CONFIG`, `AI_MODEL_PROVIDER`, and `AI_REQUEST_TIMEOUT_MS` can override the model, configuration file, provider, and request timeout for a single run. Configuration errors fail closed.

## Checks, preview, and publishing

```sh
pnpm check:multilingual:structure
pnpm check:multilingual
pnpm test:multilingual
pnpm docs:build
pnpm docs:preview
```

`check:multilingual:structure` is the site-wide deterministic stage and needs no model or credentials. `check:multilingual` is the full site-wide two-stage review: structure first, then semantics. `test:multilingual` runs translation and safety behavior tests; `docs:build` and `docs:preview` build and preview the production site.

Before publishing, run `pnpm content:sync`, review the generated pages, and run `pnpm check:multilingual` to complete the full site-wide two-stage review. Commit the Chinese source, the generated English and Traditional Chinese pages, and the state manifest together so the next sync has a trusted baseline.

Pushes to `main` trigger `.github/workflows/static.yml`, which installs dependencies, builds the site, and deploys `docs/.vitepress/dist` to GitHub Pages. The repository's Pages source must be **GitHub Actions**. The workflow runs no model calls and holds no model credentials; production always disables AI search. After deployment, wait for the workflow and spot-check all three editions.

## Site and safety rules

- The root URL selects the browser's preferred edition: Traditional Chinese (`zh-TW`, `zh-HK`, `zh-MO`, `zh-Hant`) → `/zh-tw/`, other Chinese → `/zh-cn/`, everything else or JavaScript disabled → `/en/`. Explicit language paths and the navigation language menu always remain available.
- The light or dark appearance follows the browser's system preference until the visitor uses the theme switch; a manual choice persists across visits. The browser toolbar color follows the active appearance.
- All three editions share the same relative paths, structure, facts, and content coverage. Keep public URLs, user content, and external links stable unless explicitly authorized to change them. Keep `README.md`, `README.zh-CN.md`, and `README.zh-TW.md` semantically identical when commands, structure, or rules change.
- Every browser runtime asset is served from this origin. Do not add CDNs, third-party fonts, or remote rendering services; the CSP restricts runtime resource sources.
- This repository may be edited by multiple agents in a shared worktree. Assign each file to one owner, never reset or overwrite another person's changes, and never delete unrecognized user content. Agents must not run build, test, lint, or format commands mid-flight; the main agent verifies once after all changes land.
- Report real results, blockers, risks, and decisions. Never claim an unrun check passed, fabricate translation quality, or weaken privacy or security to make a check pass.
