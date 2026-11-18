import { defineConfig, type DefaultTheme } from 'vitepress'

export const zh_cn = defineConfig({
    lang: 'zh-CN',
    description: "个人主页。",
    title: '郭彦禛',
    themeConfig: {
        nav: [
            { text: '关于', link: '/zh-cn/About/', activeMatch: '^/zh-cn/About/' },
            { text: '项目', link: '/zh-cn/Projects/', activeMatch: '^/zh-cn/Projects/' },
            { text: '笔记', link: '/zh-cn/Notes/', activeMatch: '^/zh-cn/Notes/' }
        ],
        sidebar: {
            '/zh-cn/About/': sidebarAbout(),
            '/zh-cn/Projects/': sidebarProjects(),
            '/zh-cn/Notes/': sidebarNotes()
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
    return [{ text: '关于', link: '/zh-cn/About/' }]
}

function sidebarProjects(): DefaultTheme.SidebarItem[] {
    return [{ text: '项目', link: '/zh-cn/Projects/' }]
}

function sidebarNotes(): DefaultTheme.SidebarItem[] {
    return [{
        text: '笔记',
        link: '/zh-cn/Notes/',
        items: [
            {
                text: '课程笔记',
                link: '/zh-cn/Notes/Courses/',
                items: [{ text: '课程笔记演示', link: '/zh-cn/Notes/Courses/demo' }]
            },
            {
                text: '学习笔记',
                link: '/zh-cn/Notes/Learning/',
                items: [{ text: '学习笔记演示', link: '/zh-cn/Notes/Learning/demo' }]
            },
            {
                text: '工作笔记',
                link: '/zh-cn/Notes/Work/',
                items: [{ text: '工作笔记演示', link: '/zh-cn/Notes/Work/demo' }]
            }
        ]
    }]
}
