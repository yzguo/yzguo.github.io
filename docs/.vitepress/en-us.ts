import { defineConfig, type DefaultTheme } from 'vitepress'

export const en_us = defineConfig({
    lang: 'en-US',
    description: "Personal homepage.",
    themeConfig: {
        nav: [
            { text: 'About', link: '/About/', activeMatch: '^/About/' },
            { text: 'Projects', link: '/Projects/', activeMatch: '^/Projects/' },
            { text: 'Notes', link: '/Notes/', activeMatch: '^/Notes/' }
        ],
        sidebar: {
            '/About/': sidebarAbout(),
            '/Projects/': sidebarProjects(),
            '/Notes/': sidebarNotes()
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
    return [{ text: 'About', link: '/About/' }]
}

function sidebarProjects(): DefaultTheme.SidebarItem[] {
    return [{ text: 'Projects', link: '/Projects/' }]
}

function sidebarNotes(): DefaultTheme.SidebarItem[] {
    return [{
        text: 'Notes',
        link: '/Notes/',
        items: [
            {
                text: 'Course notes',
                link: '/Notes/Courses/',
                items: [{ text: 'Course notes demo', link: '/Notes/Courses/demo' }]
            },
            {
                text: 'Learning notes',
                link: '/Notes/Learning/',
                items: [{ text: 'Learning notes demo', link: '/Notes/Learning/demo' }]
            },
            {
                text: 'Work notes',
                link: '/Notes/Work/',
                items: [{ text: 'Work notes demo', link: '/Notes/Work/demo' }]
            }
        ]
    }]
}
