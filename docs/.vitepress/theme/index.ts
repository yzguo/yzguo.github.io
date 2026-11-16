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

/*
 * The AI search entry is a development-only addition to the default layout.
 * In a production build `import.meta.env.DEV` is statically false, so the
 * default layout is used unchanged and the development-only chunk is not
 * loaded. Existing navigation, local search, fonts, and CSP remain untouched.
 */
const LocalAISearch = import.meta.env.DEV
    ? defineAsyncComponent(() => import('./LocalAISearch.vue'))
    : null

const Layout: Theme['Layout'] = import.meta.env.DEV
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
