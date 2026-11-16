# 郭彦禛个人网站

基于 VitePress 构建、使用 Markdown 写作的中英双语个人网站，通过 GitHub Pages 发布。

- English: <https://yzguo.github.io/>
- 简体中文: <https://yzguo.github.io/zh-cn/>

## 内容结构

- `docs/About/` 与 `docs/zh-cn/About/`：个人介绍与教育经历。
- `docs/Projects/` 与 `docs/zh-cn/Projects/`：项目索引与项目页面。
- `docs/Blogs/` 与 `docs/zh-cn/Blogs/`：课程、学习和工作笔记。

博客区分为 `Courses/`、`Learning/` 和 `Work/` 三个分类。每个分类都包含索引页和演示文章。复制演示文章的 Markdown 文件，替换示例提示，并在分类索引中添加链接即可。内容增加后，可以继续建立子文件夹分类。

英文页面位于 `docs/`，对应的简体中文页面放在 `docs/zh-cn/` 下相同的相对路径。新增内容时请同步更新两种语言。

## 本地开发

需要 Node.js 和 pnpm：

```sh
pnpm install --frozen-lockfile
pnpm docs:dev
```

使用 `pnpm docs:build` 构建生产网站，使用 `pnpm docs:preview` 预览构建结果。

## 自动部署

推送到 `main` 会触发 `.github/workflows/static.yml`，构建网站并将 `docs/.vitepress/dist` 发布到 GitHub Pages。仓库 Pages 的发布来源需设置为 **GitHub Actions**。

Markdown 支持 LaTeX 数学公式和 Mermaid 图表，可参考博客中的演示文章。
