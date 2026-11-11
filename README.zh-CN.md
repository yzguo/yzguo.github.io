# 郭彦禛 — 个人网站

基于 [VitePress](https://vitepress.dev/) 构建的 Markdown 个人网站，发布于 <https://yzguo.github.io/>。

## 编写内容

英文页面位于 `docs/`，中文页面位于 `docs/zh-CN/`。发布更新时请同步维护对应语言版本。

| 栏目 | English | 中文 |
| --- | --- | --- |
| 首页 | `docs/index.md` | `docs/zh-CN/index.md` |
| 关于 | `docs/about.md` | `docs/zh-CN/about.md` |
| 项目 | `docs/projects.md` | `docs/zh-CN/projects.md` |
| 博客 | `docs/blog/` | `docs/zh-CN/blog/` |

在对应目录下创建 Markdown 文件，并从栏目索引页添加链接。网站默认跟随系统浅色/深色主题，访客也可以手动切换。

## 数学公式与图表

数学公式使用 LaTeX 定界符（行内公式 `$...$`、独立公式 `$$...$$`）；Mermaid 图表使用 `mermaid` 围栏代码块。示例请看博客中的“数学与图表示例”。

## 本地预览

需要 Node.js 20+ 和 Corepack：

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm docs:dev
```

运行 `corepack pnpm docs:build` 构建静态网站。

运行 `corepack pnpm check:bilingual` 检查中英文页面是否成对，并对照 Markdown 结构。CI 会在每次构建前自动执行该检查。

## 自动部署

每次推送到 `main` 都会运行 `.github/workflows/deploy.yml`，并将构建产物发布到 GitHub Pages。请在仓库 Settings → Pages → Build and deployment → Source 中选择 **GitHub Actions**。工作流使用 `GITHUB_TOKEN`，无需单独配置部署密钥。
