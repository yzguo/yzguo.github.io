import { defineConfig, type DefaultTheme } from 'vitepress'

export const en_us = defineConfig({
    lang: 'en-US',
    description: "Personal homepage.",
    title: 'Yanzhen Guo',
    themeConfig: {
        nav: [
            { text: 'About', link: '/en/About/', activeMatch: '^/en/About/' },
            { text: 'Projects', link: '/en/Projects/', activeMatch: '^/en/Projects/' },
            { text: 'Notes', link: '/en/Notes/', activeMatch: '^/en/Notes/' }
        ],
        sidebar: {
            '/en/About/': sidebarAbout(),
            '/en/Projects/': sidebarProjects(),
            '/en/Notes/': sidebarNotes()
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
        darkModeSwitchLabel: "Theme",
        lightModeSwitchTitle: "Switch to light theme",
        darkModeSwitchTitle: "Switch to dark theme"
    }
})

function sidebarAbout(): DefaultTheme.SidebarItem[] {
    return [{ text: 'About', link: '/en/About/' }]
}

function sidebarProjects(): DefaultTheme.SidebarItem[] {
    return [{ text: 'Projects', link: '/en/Projects/' }]
}

function sidebarNotes(): DefaultTheme.SidebarItem[] {
    return [{
        text: 'Notes',
        link: '/en/Notes/',
        items: [
            {
                text: 'Course notes',
                link: '/en/Notes/Courses/',
                items: [{ text: 'Course notes demo', link: '/en/Notes/Courses/demo' }]
            },
            {
                text: 'Learning notes',
                link: '/en/Notes/Learning/',
                items: [{ text: 'Learning notes demo', link: '/en/Notes/Learning/demo' }]
            },
            {
                text: 'Work notes',
                link: '/en/Notes/Work/',
                items: [{ text: 'Work notes demo', link: '/en/Notes/Work/demo' }]
            }
        ]
    }]
}
