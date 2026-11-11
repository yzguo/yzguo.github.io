import { defineConfig, type DefaultTheme } from 'vitepress'

export const zh_cn = defineConfig({
    lang: 'zh-CN',
    description: "个人主页。",
    themeConfig: {
        nav: [
            { text: 'About', link: '/zh-cn/About/', activeMatch: '^/zh-cn/About/' },
            { text: 'Projects', link: '/zh-cn/Projects/', activeMatch: '^/zh-cn/Projects/' },
            { text: 'Blogs', link: '/zh-cn/Blogs/', activeMatch: '^/zh-cn/Blogs/' }
        ],
        sidebar: {
            '/zh-cn/About/': { base: '/zh-cn/About/', items: sidebarAbout() },
            '/zh-cn/Projects/': { base: '/zh-cn/Projects/', items: sidebarProjects() },
            '/zh-cn/Blogs/': { base: '/zh-cn/Blogs/', items: sidebarBlogs() }
        },
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

function sidebarAbout(): DefaultTheme.SidebarItem[] {
    return [{ text: 'About', link: '' }]
}

function sidebarProjects(): DefaultTheme.SidebarItem[] {
    return [{ text: 'Projects', link: '' }]
}

function sidebarBlogs(): DefaultTheme.SidebarItem[] {
    return [{ text: 'Blogs', link: '' }]
}
