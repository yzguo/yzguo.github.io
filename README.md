# Yanzhen Guo — personal website

Markdown-first bilingual personal site built with [VitePress](https://vitepress.dev/) and published at <https://yzguo.github.io/>.

# 郭言臻个人网站

使用 Markdown 编写的中英双语个人网站，基于 [VitePress](https://vitepress.dev/)，发布于 <https://yzguo.github.io/>。

## Write content / 编写内容

English pages live in `docs/`; Chinese translations live in `docs/zh-CN/`. Keep corresponding pages in sync when publishing updates. The navigation language menu links between the two complete site versions.

英文页面位于 `docs/`，中文页面位于 `docs/zh-CN/`。更新内容时请同步维护对应语言版本；导航栏的语言菜单可在两种语言之间切换。

| Section / 栏目 | English | 中文 |
| --- | --- | --- |
| Home / 首页 | `docs/index.md` | `docs/zh-CN/index.md` |
| About / 关于 | `docs/about.md` | `docs/zh-CN/about.md` |
| Projects / 项目 | `docs/projects.md` | `docs/zh-CN/projects.md` |
| Notes / 笔记 | `docs/notes/` | `docs/zh-CN/notes/` |

Create Markdown files under the relevant directory and link them from its index page. Write normal Markdown; no Vue or web-development knowledge is needed. The appearance follows the operating system by default, and visitors can switch between light and dark themes.

在对应目录下创建 Markdown 文件，并从栏目索引页添加链接。日常写作只需 Markdown，无需 Vue 或网页开发知识。网站默认跟随系统浅色/深色主题，也允许访客手动切换。

## Math and diagrams / 数学公式与图表

Inline and display math use LaTeX delimiters:

```md
Inline: $E = mc^2$

$$
\nabla \cdot \mathbf{E} = \frac{\rho}{\varepsilon_0}
$$
```

Mermaid diagrams use a fenced `mermaid` block:

````md
```mermaid
flowchart LR
  Question --> Model --> Insight
```
````

数学公式使用 LaTeX 定界符，行内公式用 `$...$`，独立公式用 `$$...$$`。Mermaid 图表使用语言标记为 `mermaid` 的围栏代码块。可参考两种语言的 Notes → Markdown examples 页面。

## Preview locally / 本地预览

Requires Node.js 20+ and Corepack / 需要 Node.js 20+ 和 Corepack：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm docs:dev
```

Run a production build / 构建生产版本：

```sh
corepack pnpm docs:build
```

## Automatic deployment / 自动部署

Every push to `main` runs `.github/workflows/deploy.yml`: install locked dependencies, build the static site, and publish it to GitHub Pages. Set Repository → Settings → Pages → Build and deployment → Source to **GitHub Actions**. The workflow uses `GITHUB_TOKEN`; no deploy secret is required.

每次推送到 `main` 都会运行 `.github/workflows/deploy.yml`，安装锁定依赖、构建网站并发布至 GitHub Pages。请在仓库 Settings → Pages → Build and deployment → Source 中选择 **GitHub Actions**。工作流使用 `GITHUB_TOKEN`，无需另设部署密钥。
