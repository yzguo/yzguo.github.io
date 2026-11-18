import { defineConfig, type DefaultTheme } from 'vitepress'

export const zh_tw = defineConfig({
    lang: 'zh-TW',
    description: "個人主頁。",
    title: '郭彥禛',
    themeConfig: {
        nav: [
            { text: '關於', link: '/zh-tw/About/', activeMatch: '^/zh-tw/About/' },
            { text: '專案', link: '/zh-tw/Projects/', activeMatch: '^/zh-tw/Projects/' },
            { text: '筆記', link: '/zh-tw/Notes/', activeMatch: '^/zh-tw/Notes/' }
        ],
        sidebar: {
            '/zh-tw/About/': sidebarAbout(),
            '/zh-tw/Projects/': sidebarProjects(),
            '/zh-tw/Notes/': sidebarNotes()
        },
        editLink: {
            pattern: 'https://github.com/yzguo/yzguo.github.io/edit/main/docs/:path',
            text: "在 GitHub 上編輯此頁"
        },
        docFooter: {"prev":"← 上一頁","next":"下一頁 →"},
        outline: {"label":"頁面目錄"},
        lastUpdated: {"text":"最後更新於","formatOptions":{"dateStyle":"short","timeStyle":"medium"}},
        langMenuLabel: "多語言",
        returnToTopLabel: "回到頂部",
        sidebarMenuLabel: "選單",
        darkModeSwitchLabel: "主題",
        lightModeSwitchTitle: "切換到淺色模式",
        darkModeSwitchTitle: "切換到深色模式"
    }
})

function sidebarAbout(): DefaultTheme.SidebarItem[] {
    return [{ text: '關於', link: '/zh-tw/About/' }]
}

function sidebarProjects(): DefaultTheme.SidebarItem[] {
    return [{ text: '專案', link: '/zh-tw/Projects/' }]
}

function sidebarNotes(): DefaultTheme.SidebarItem[] {
    return [{
        text: '筆記',
        link: '/zh-tw/Notes/',
        items: [
            {
                text: '課程筆記',
                link: '/zh-tw/Notes/Courses/',
                items: [{ text: '課程筆記示範', link: '/zh-tw/Notes/Courses/demo' }]
            },
            {
                text: '學習筆記',
                link: '/zh-tw/Notes/Learning/',
                items: [{ text: '學習筆記示範', link: '/zh-tw/Notes/Learning/demo' }]
            },
            {
                text: '工作筆記',
                link: '/zh-tw/Notes/Work/',
                items: [{ text: '工作筆記示範', link: '/zh-tw/Notes/Work/demo' }]
            }
        ]
    }]
}
