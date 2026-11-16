import { defineConfig, type DefaultTheme } from 'vitepress'

export const en_us = defineConfig({
    lang: 'en-US',
    description: "Yanzhen Guo's personal homepage.",
    themeConfig: {
        nav: [
            { text: 'About', link: '/About/', activeMatch: '^/About/' },
            { text: 'Projects', link: '/Projects/', activeMatch: '^/Projects/' },
            { text: 'Blogs and notes', link: '/Blogs/', activeMatch: '^/Blogs/' }
        ],
        sidebar: {
            '/About/': sidebarAbout(),
            '/Projects/': sidebarProjects(),
            '/Blogs/': sidebarBlogs()
        },
        editLink: {
            pattern: 'https://github.com/yzguo/yzguo.github.io/edit/main/docs/:path',
            text: "Edit this page on GitHub"
        },
        docFooter: {"prev":"← Previous page","next":"Next page →"},
        outline: {"label":"On this page"},
        lastUpdated: {"text":"Last updated","formatOptions":{"dateStyle":"short","timeStyle":"medium"}},
        langMenuLabel: "Languages",
        returnToTopLabel: "Return to top",
        sidebarMenuLabel: "Menu",
        darkModeSwitchLabel: "Appearance",
        lightModeSwitchTitle: "Switch to light theme",
        darkModeSwitchTitle: "Switch to dark theme"
    }
})

function sidebarAbout(): DefaultTheme.SidebarItem[] {
    return [{ text: 'About', link: '/About/' }]
}

function sidebarProjects(): DefaultTheme.SidebarItem[] {
    return [{ text: 'Projects', link: '/Projects/' }]
}

function sidebarBlogs(): DefaultTheme.SidebarItem[] {
    return [{
        text: 'Blogs and notes',
        link: '/Blogs/',
        items: [
            {
                text: 'Course notes',
                link: '/Blogs/Courses/',
                items: [{ text: 'Course notes demo', link: '/Blogs/Courses/demo' }]
            },
            {
                text: 'Learning notes',
                link: '/Blogs/Learning/',
                items: [{ text: 'Learning notes demo', link: '/Blogs/Learning/demo' }]
            },
            {
                text: 'Work notes',
                link: '/Blogs/Work/',
                items: [{ text: 'Work notes demo', link: '/Blogs/Work/demo' }]
            }
        ]
    }]
}
