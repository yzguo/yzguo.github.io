import { defineConfig } from 'vitepress'
import { buildLocaleNavigation } from './navigation.mjs'

/*
 * 导航与侧栏由 docs/zh-cn 的 Markdown 树自动生成；新增页面或运行
 * content:sync 后无需修改本文件。标题取本语言 frontmatter title 或首个可见
 * H1。这里只维护可见界面文案。
 */
const navigation = buildLocaleNavigation('zh-cn')

export const zh_cn = defineConfig({
    lang: 'zh-CN',
    description: "个人主页。",
    title: '郭彦禛',
    themeConfig: {
        nav: navigation.nav,
        sidebar: navigation.sidebar,
        editLink: {
            pattern: 'https://github.com/yzguo/yzguo.github.io/edit/main/docs/:path',
            text: "在 GitHub 上编辑此页"
        },
        docFooter: {"prev":"← 上一页","next":"下一页 →"},
        outline: {"label":"页面目录"},
        lastUpdated: {"text":"最后更新于","formatOptions":{"dateStyle":"short","timeStyle":"medium"}},
        langMenuLabel: "多语言",
        returnToTopLabel: "回到顶部",
        sidebarMenuLabel: "菜单",
        darkModeSwitchLabel: "主题",
        lightModeSwitchTitle: "切换到浅色模式",
        darkModeSwitchTitle: "切换到深色模式"
    }
})
