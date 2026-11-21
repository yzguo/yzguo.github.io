import { defineConfig } from 'vitepress'
import { themeColor } from './theme-color.mjs'

export const headConfig = defineConfig({
    head: [
        // Every page renders Latin text from this one consolidated face.
        // Preloading it starts the font fetch in parallel with the
        // render-blocking stylesheet instead of after the CSS is parsed.
        // crossorigin must match the font request's CORS mode or the browser
        // downloads the file twice.
        ['link', {
            rel: 'preload',
            href: '/fonts/noto-sans-sc/noto-sans-sc-common.woff2',
            as: 'font',
            type: 'font/woff2',
            crossorigin: 'anonymous'
        }],
        // PNG fallback for browsers without SVG favicon support (older Safari).
        ['link', { rel: 'icon', href: '/images/favicon-48.png', type: 'image/png', sizes: '48x48' }],
        ['link', { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml', sizes: 'any' }],
        ['meta', { property: 'og:type', content: 'website' }],
        ['meta', { property: 'og:site_name', content: 'Yanzhen Guo' }],
        ['meta', { property: 'og:image', content: 'https://yzguo.github.io/images/pic.png' }],
        ['meta', { property: 'og:image:type', content: 'image/png' }],
        ['meta', { property: 'og:image:width', content: '320' }],
        ['meta', { property: 'og:image:height', content: '320' }],
        // All runtime assets must come from this site, including fonts and diagrams.
        ['meta', { 'http-equiv': 'Content-Security-Policy', content: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'" }],
        /*
         * VitePress needs JavaScript to apply the dark class, so a visitor
         * without scripts always sees the light theme. Keep the light toolbar
         * color for that case; with scripts enabled this noscript content is
         * inert and the script below owns the single theme-color tag.
         */
        ['noscript', {}, `<meta name="theme-color" content="${themeColor.light}">`],
        /*
         * The browser toolbar color follows the resolved appearance. It cannot
         * be a static tag in this array: VitePress's client head manager owns
         * those tags and recreates them on route changes, while the appearance
         * can change later. This script runs in <head> during the production
         * parse, before first paint, and resolves the same stored preference as
         * VitePress's own dark-mode script. It inserts an unmanaged tag, so
         * route head updates leave it alone; theme/index.ts watches
         * VitePress's `isDark` ref for later system and manual changes. If
         * storage is blocked, VitePress's dark-mode script cannot run either,
         * so the first paint stays light until the watcher applies the
         * hydrated state.
         * The dev SPA does not execute head scripts, so its theme setup creates
         * the tag after mount.
         */
        ['script', { id: 'theme-color' }, `(function () {
    var stored = null;
    try {
        stored = localStorage.getItem('vitepress-theme-appearance');
    } catch (error) {
        // VitePress's own dark-mode script cannot read storage either, so it
        // leaves the page light. Keep the toolbar light until the theme
        // watcher runs and applies the hydrated state.
        stored = 'light';
    }
    var prefersDark = window.matchMedia
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : false;
    var dark = !stored || stored === 'auto' ? prefersDark : stored === 'dark';
    var meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = dark
        ? ${JSON.stringify(themeColor.dark)}
        : ${JSON.stringify(themeColor.light)};
    document.head.insertBefore(meta, document.head.firstChild);
})();`],
        // The locale content face is chosen by <html lang>, which the parser
        // has already written at this point. Preloading it starts the single
        // ~115-125 kB CJK request in parallel with the stylesheet instead of
        // waiting for the CSS to be parsed and matched. English and the root
        // entry page add nothing: their text is already covered by the common
        // Latin face above.
        ['script', {}, `(function () {
    var lang = (document.documentElement.lang || '').toLowerCase();
    var file = lang === 'zh-cn'
        ? 'noto-sans-sc-site-cn.woff2'
        : lang === 'zh-tw'
            ? 'noto-sans-sc-site-tw.woff2'
            : '';
    if (!file) return;
    var link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'font';
    link.type = 'font/woff2';
    link.crossOrigin = 'anonymous';
    link.href = '/fonts/noto-sans-sc/' + file;
    document.head.appendChild(link);
})();`]
    ]
})
