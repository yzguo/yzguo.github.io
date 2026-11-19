/*
 * Browser-language selection for the site root.
 *
 * GitHub Pages is a static host: it cannot read Accept-Language and cannot
 * redirect before the HTML document is sent. The root document is therefore a
 * minimal English entry page. With JavaScript disabled it carries a
 * `<noscript>` meta refresh to the English site; with JavaScript enabled a
 * tiny inline script picks the locale before stylesheets, fonts, images, and
 * theme modules are requested. If detection throws, the script tries the
 * English target as a fallback. Explicit locale URLs (/en/, /zh-cn/, /zh-tw/)
 * never redirect.
 *
 * `resolveRootRedirect` must stay completely self-contained: its source is
 * embedded in that inline script by `buildRootLanguageRedirectScript`. Do not
 * reference module-level helpers, constants, or imports from inside it.
 */

const ROOT_LANGUAGE_PAGE = 'index.md'

/**
 * Map browser language preferences to a site locale and resolve the only
 * client-side redirect this site allows: the language entry page at the site
 * root. The first usable language decides the result: Traditional Chinese
 * tags (zh-Hant, zh-TW, zh-HK, zh-MO) go to zh-tw, every other Chinese tag to
 * zh-cn, and everything else (including unknown/empty input) to English.
 *
 * Query and hash are carried over unchanged. `null` means no redirect, either
 * because this is not the root page or because the target is the current URL.
 */
export function resolveRootRedirect({
    pathname,
    search = '',
    hash = '',
    languages,
    base = '/'
}) {
    const rawBase = typeof base === 'string' && base ? base : '/'
    const withLeadingSlash = rawBase.startsWith('/') ? rawBase : `/${rawBase}`
    const normalizedBase = withLeadingSlash.endsWith('/')
        ? withLeadingSlash
        : `${withLeadingSlash}/`

    // Only the root document redirects. A page reached from the language menu
    // or by an explicit locale URL is never overridden.
    if (
        pathname !== normalizedBase &&
        pathname !== `${normalizedBase}index.html`
    ) {
        return null
    }

    // navigator.languages is an array-like list (DOMStringList in some
    // browsers), not necessarily an Array. Skip empty entries so the first
    // usable preference wins.
    let preferred
    if (
        languages &&
        typeof languages === 'object' &&
        typeof languages.length === 'number'
    ) {
        for (let index = 0; index < languages.length; index += 1) {
            const value = languages[index]
            if (typeof value === 'string' && value.trim()) {
                preferred = value
                break
            }
        }
    } else {
        preferred = languages
    }

    const tag = String(preferred == null ? 'en' : preferred)
        .trim()
        .toLowerCase()
    const traditionalPrefixes = ['zh-hant', 'zh-tw', 'zh-hk', 'zh-mo']
    let locale = 'en'

    for (let index = 0; index < traditionalPrefixes.length; index += 1) {
        const prefix = traditionalPrefixes[index]
        if (tag === prefix || tag.startsWith(`${prefix}-`)) {
            locale = 'zh-tw'
            break
        }
    }

    if (locale === 'en' && (tag === 'zh' || tag.startsWith('zh-'))) {
        locale = 'zh-cn'
    }

    const query =
        typeof search === 'string' && search
            ? search.startsWith('?')
                ? search
                : `?${search}`
            : ''
    const fragment =
        typeof hash === 'string' && hash
            ? hash.startsWith('#')
                ? hash
                : `#${hash}`
            : ''
    const target = `${normalizedBase}${locale}/${query}${fragment}`
    const current = `${pathname}${query}${fragment}`

    // Never return a URL that is already loaded; this is the loop guard.
    return target === current ? null : target
}

function inlineScriptJson(value) {
    return JSON.stringify(value).replace(/</g, '\\u003C')
}

function normalizeBase(base) {
    const rawBase = typeof base === 'string' && base ? base : '/'
    const withLeadingSlash = rawBase.startsWith('/') ? rawBase : `/${rawBase}`
    return withLeadingSlash.endsWith('/')
        ? withLeadingSlash
        : `${withLeadingSlash}/`
}

function escapeHtmlAttribute(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}

/**
 * Build the self-contained inline script injected into the root document.
 * It reads `window.navigator.languages` (falling back to `navigator.language`),
 * calls the serialized `resolveRootRedirect`, and uses `location.replace` so
 * the language entry never adds a history entry. If detection or the first
 * navigation throws, it retries with English for the root URL; otherwise the
 * page stays on the minimal English entry page.
 */
export function buildRootLanguageRedirectScript(base = '/') {
    // Function.prototype.toString omits the `export` keyword in current
    // engines; strip it defensively in case a transformer prepends it.
    const redirectSource = resolveRootRedirect
        .toString()
        .replace(/^\s*export\s+/, '')
    const baseSource = inlineScriptJson(
        typeof base === 'string' && base ? base : '/'
    )

    return [
        '(function () {',
        '  try {',
        `    var redirect = ${redirectSource};`,
        '    var browser = window.navigator || {};',
        '    var languages = browser.languages;',
        '    if (languages && typeof languages !== "string" && typeof languages.length === "number" && languages.length > 0) {',
        '      languages = Array.prototype.slice.call(languages);',
        '    } else if (typeof languages === "string" && languages) {',
        '      languages = [languages];',
        '    } else if (browser.language) {',
        '      languages = [browser.language];',
        '    } else {',
        '      languages = [];',
        '    }',
        `    var target = redirect({ pathname: window.location.pathname,` +
            ` search: window.location.search, hash: window.location.hash,` +
            ` languages: languages, base: ${baseSource} });`,
        '    if (target !== null) {',
        '      window.location.replace(target);',
        '    }',
        '  } catch (error) {',
        '    try {',
        `      var fallback = redirect({ pathname: window.location.pathname,` +
            ` search: window.location.search, hash: window.location.hash,` +
            ` languages: ["en"], base: ${baseSource} });`,
        '      if (fallback !== null) {',
        '        window.location.replace(fallback);',
        '      }',
        '    } catch (fallbackError) {}',
        '  }',
        '})();'
    ].join('\n')
}

/**
 * Insert the no-JavaScript English redirect and the language script at the top
 * of `<head>` (after the charset meta), before VitePress emits its stylesheet,
 * font, metadata, and module-script tags. Returns the input unchanged for
 * every page other than the root document.
 */
export function injectRootLanguageRedirect(
    html,
    { relativePath, base = '/' } = {}
) {
    if (
        relativePath !== ROOT_LANGUAGE_PAGE ||
        typeof html !== 'string'
    ) {
        return html
    }

    const headMatch = /<head(?:\s[^>]*)?>/i.exec(html)
    if (!headMatch) return html

    const headStart = headMatch.index
    // Keep the charset declaration inside the first 1024 bytes; the redirect
    // script still precedes every stylesheet, font, image, and module script.
    let insertAt = headStart + headMatch[0].length
    const headEnd = html.indexOf('</head>', insertAt)
    const charsetStart = html.indexOf('<meta charset', insertAt)
    if (
        charsetStart !== -1 &&
        (headEnd === -1 || charsetStart < headEnd)
    ) {
        const charsetEnd = html.indexOf('>', charsetStart)
        if (charsetEnd !== -1) insertAt = charsetEnd + 1
    }
    const normalizedBase = normalizeBase(base)
    const englishUrl = escapeHtmlAttribute(`${normalizedBase}en/`)
    const noscript =
        `<noscript><meta http-equiv="refresh" content="0;url=${englishUrl}"></noscript>`
    const script = `<script>${buildRootLanguageRedirectScript(normalizedBase)}</script>`
    return `${html.slice(0, insertAt)}${noscript}${script}${html.slice(insertAt)}`
}
