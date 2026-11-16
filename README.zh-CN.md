# 郭彦禛个人网站

基于 VitePress 构建、使用 Markdown 写作的中英双语个人网站，通过 GitHub Pages 发布。

- English: <https://yzguo.github.io/>
- 简体中文: <https://yzguo.github.io/zh-cn/>

## 内容结构

- `docs/About/` 与 `docs/zh-cn/About/`：个人介绍与教育经历。
- `docs/Projects/` 与 `docs/zh-cn/Projects/`：项目索引与项目页面。
- `docs/Blogs/` 与 `docs/zh-cn/Blogs/`：课程、学习和工作笔记。

博客区分为 `Courses/`、`Learning/` 和 `Work/` 三个分类。每个分类都包含索引页和示例文章。可以复制示例文章的 Markdown 文件，替换为自己的笔记，并在分类索引中添加链接。内容增加后，可以继续建立子文件夹分类。

中文页面位于 `docs/zh-cn/`，英文页面放在 `docs/` 下相同的相对路径。本地翻译工具以中文页面为源。

## 本地开发

本地翻译、双语检查和 AI 搜索需要 Node.js、pnpm，以及已配置 `ustc/deepseek-flash` 模型的 Oh My Pi（`omp`）：

```sh
pnpm install --frozen-lockfile
pnpm docs:dev
```

使用 `pnpm docs:build` 构建生产网站，使用 `pnpm docs:preview` 预览构建结果。运行 `pnpm check:bilingual` 检查页面结构、导航和界面文案以及翻译语义的一致性；检查会将中英文页面及界面内容发送给配置的模型，应人工审阅模型结果，而不应将其视为翻译质量的证明。

在本机运行 `pnpm docs:dev` 时，AI 搜索按钮使用本机配置的 Oh My Pi 模型，根据本站内容回答问题。问题和相关公开页面摘录会发送到模型服务。AI 接口仅允许本机访问；发布后的网站保留普通本地搜索，不会获得你的模型凭据。

## 本地翻译

```sh
pnpm translate:docs
pnpm translate:docs:write
pnpm translate:docs:force
pnpm check:bilingual
```

第一条命令只列出中文源文件和英文目标，不写文件，也不调用模型。第二条生成缺失的英文文件；第三条会明确覆盖已有英文文件，请仔细审阅更改。最后一条检查双语页面和界面文案。翻译工具会在写入整批文件前验证每个生成结果。运行时请避免同时编辑目标文件；冲突检查不能代替备份。

工具还会将 `README.zh-CN.md` 映射到 `README.md`，并将根目录中文文件名的 Markdown 映射到对应的 `.en.md` 文件。英文文件中出现中文人名不会使其被当作中文源文件。

程序代码、公式和链接目标会原样保留。流程图、时序图和状态图中的 Mermaid 标签会被翻译；无法安全翻译的图表会报错，不会写入。发布前请审阅生成的译文。

这些工具使用本机 Oh My Pi 认证网关，不会将模型配置或凭据复制到仓库或 GitHub Actions。翻译或检查所需的文字会发送到配置的模型服务；HTML 注释和显式标记的私有块不会发送给模型。

私有块使用 `<!-- private:start -->` 和 `<!-- private:end -->` 包围；如果没有闭合，工具会报错，而不会发送块内内容。

这些标记只控制模型输入：标记内的文字仍保留在源文件中，可能通过 Git 或 VitePress 公开。不要将凭据或未公开的私人数据放入准备提交到公开仓库的文件。

## 自动部署

推送到 `main` 会触发 `.github/workflows/static.yml`，构建网站并将 `docs/.vitepress/dist` 发布到 GitHub Pages。仓库 Pages 的发布来源需设置为 **GitHub Actions**。

Markdown 支持 LaTeX 数学公式和 Mermaid 图表，课程笔记演示文章中有示例。字体和渲染资源由本站提供，不从 CDN 加载。

中文文字使用 Noto Sans SC，拉丁文字使用 Latin Modern，公式保留 MathJax 默认字形。符号字形使用 Nerd Fonts；由于 Nerd Fonts 不覆盖标准表情，表情使用本地部署的 Noto Emoji 和 Twemoji Mozilla 字体。
