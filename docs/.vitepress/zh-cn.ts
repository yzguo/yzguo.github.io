import { defineConfig } from 'vitepress'

export const zh_cn = defineConfig({
    lang: 'zh-CN',
    description: "个人主页。",
    themeConfig: {
        langMenuLabel: "多语言",
        returnToTopLabel: "回到顶部",
        sidebarMenuLabel: "菜单",
        darkModeSwitchLabel: "主题",
        lightModeSwitchTitle: "切换到浅色模式",
        darkModeSwitchTitle: "切换到深色模式",
        outline: { label: "页面目录" },
        docFooter: { prev: "上一页", next: "下一页" },
        nav: [{ text: 'About', link: '/zh-cn/About/' },
            { text: 'Projects', link: '/zh-cn/Projects/' },
            { text: 'Blogs', link: '/zh-cn/Blogs/' }],
        sidebar: [{ text: 'About', link: '/zh-cn/About/' },
            { text: 'Projects', link: '/zh-cn/Projects/' },
            { text: 'Blogs', link: '/zh-cn/Blogs/' }]
    }
})
