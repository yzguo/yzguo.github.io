import { defineConfig } from 'vitepress'

export const headConfig = defineConfig({
    head: [
        ['link', { rel: 'icon', href: '/favicon.ico' }],
        ['meta', { name: 'theme-color', content: '#0078D4' }],
        ['meta', { property: 'og:type', content: 'website' }],
        ['meta', { property: 'og:site_name', content: 'Yanzhen Guo' }],
        ['meta', { property: 'og:image', content: '/images/office-tool-plus-logo-large.webp' }],
        // All runtime assets must come from this site, including fonts and diagrams.
        ['meta', { 'http-equiv': 'Content-Security-Policy', content: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'" }]
    ]
})
