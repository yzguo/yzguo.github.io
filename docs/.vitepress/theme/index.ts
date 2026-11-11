import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import LocalMermaid from './LocalMermaid.vue'

export default {
    extends: DefaultTheme,
    enhanceApp({ app }) {
        app.component('LocalMermaid', LocalMermaid)
    }
} satisfies Theme
