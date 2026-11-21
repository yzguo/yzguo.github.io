import DefaultTheme from 'vitepress/theme-without-fonts'
import { inBrowser, useData, type Theme } from 'vitepress'
import { defineAsyncComponent, h, watchEffect } from 'vue'
import './fonts/latin-modern.css'
import './fonts/nerd-symbols.css'
import './fonts/noto-emoji.css'
import './fonts/twemoji.css'
import './fonts/noto-sans-sc.css'
import './style.css'
import { themeColor } from '../theme-color.mjs'
import LocalMermaid from './LocalMermaid.vue'
import NotesIndex from './NotesIndex.vue'

declare const __AI_SEARCH_ENABLED__: boolean

/*
 * AI search is added to the default layout only when the resolved public
 * switch is true. Production builds always compile the switch to false, so
 * the default layout is used unchanged and the AI chunk is not loaded.
 * Existing navigation, local search, fonts, and CSP remain untouched.
 */
const LocalAISearch = __AI_SEARCH_ENABLED__
    ? defineAsyncComponent(() => import('./LocalAISearch.vue'))
    : null

const Layout: Theme['Layout'] = __AI_SEARCH_ENABLED__
    ? () =>
          h(DefaultTheme.Layout, null, {
              'layout-bottom': () => h(LocalAISearch!)
          })
    : DefaultTheme.Layout

export default {
    extends: DefaultTheme,
    Layout,
    /*
     * Keep the browser toolbar color in sync with the active appearance.
     * The production head script sets it before first paint; this watcher
     * covers the nav switch, OS preference changes while the choice is
     * automatic, and the dev SPA (which does not execute head scripts). The
     * tag is intentionally not declared in head.ts, so VitePress's route head
     * updates do not replace it.
     */
    setup() {
        if (!inBrowser) return
        const { isDark } = useData()
        watchEffect(() => {
            let meta = document.querySelector<HTMLMetaElement>(
                'meta[name="theme-color"]'
            )
            if (!meta) {
                meta = document.createElement('meta')
                meta.name = 'theme-color'
                document.head.appendChild(meta)
            }
            meta.content = isDark.value
                ? themeColor.dark
                : themeColor.light
        })
    },
    enhanceApp({ app }) {
        app.component('LocalMermaid', LocalMermaid)
        app.component('NotesIndex', NotesIndex)
    }
} satisfies Theme
