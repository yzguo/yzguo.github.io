import { defineConfig } from 'vitepress'
import { buildLocaleNavigation } from './navigation.mjs'

/*
 * Nav and sidebar are generated from docs/en plus the shared Simplified
 * Chinese source tree. Adding a page or running content:sync never requires
 * editing this file; titles come from the English frontmatter title or first
 * visible H1. Only the visible UI labels below are maintained here.
 */
const navigation = buildLocaleNavigation('en')

export const en_us = defineConfig({
    lang: 'en-US',
    description: "Personal homepage.",
    title: 'Yanzhen Guo',
    themeConfig: {
        nav: navigation.nav,
        sidebar: navigation.sidebar,
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
