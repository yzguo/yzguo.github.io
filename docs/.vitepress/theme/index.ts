import DefaultTheme from 'vitepress/theme-without-fonts'
import type { Theme } from 'vitepress'
import { defineAsyncComponent, h } from 'vue'
import './fonts/latin-modern.css'
import './fonts/nerd-symbols.css'
import './fonts/noto-emoji.css'
import './fonts/twemoji.css'
import './fonts/noto-sans-sc.css'
import './style.css'
import LocalMermaid from './LocalMermaid.vue'

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
    enhanceApp({ app }) {
        app.component('LocalMermaid', LocalMermaid)
    }
} satisfies Theme
