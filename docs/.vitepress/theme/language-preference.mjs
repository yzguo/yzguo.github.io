const TRADITIONAL_CHINESE_PREFIXES = ['zh-hant', 'zh-tw', 'zh-hk', 'zh-mo']

function firstUsableLanguage(languages) {
    if (!Array.isArray(languages)) return languages
    return languages.find((value) => typeof value === 'string' && value.trim()) ?? 'en'
}

/**
 * Map a browser language tag to the site locale. Only the preferred language
 * decides the result: Traditional Chinese tags go to zh-tw, any other Chinese
 * tag to zh-cn, and every other language to English.
 */
export function selectLocale(languages) {
    const preferred = firstUsableLanguage(languages)
    const tag = String(preferred ?? 'en').trim().toLowerCase()

    if (
        TRADITIONAL_CHINESE_PREFIXES.some(
            (prefix) => tag === prefix || tag.startsWith(`${prefix}-`)
        )
    ) {
        return 'zh-tw'
    }

    if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-cn'
    return 'en'
}

export function normalizeBase(base) {
    const value = typeof base === 'string' && base ? base : '/'
    const withLeadingSlash = value.startsWith('/') ? value : `/${value}`
    return withLeadingSlash.endsWith('/')
        ? withLeadingSlash
        : `${withLeadingSlash}/`
}

function withPrefix(prefix, value) {
    if (typeof value !== 'string' || !value) return ''
    return value.startsWith(prefix) ? value : `${prefix}${value}`
}

/**
 * Resolve the only client-side redirect this site allows: the language entry
 * page at the site root. A non-root pathname always returns null, so pages
 * opened at an explicit language URL (or reached by the language menu) are
 * never overridden. Query and hash are carried over unchanged.
 */
export function resolveRootRedirect({
    pathname,
    search = '',
    hash = '',
    languages,
    base = '/'
}) {
    const normalizedBase = normalizeBase(base)
    const rootPaths = new Set([
        normalizedBase,
        `${normalizedBase}index.html`
    ])

    if (!rootPaths.has(pathname)) return null

    const locale = selectLocale(languages)
    const query = withPrefix('?', search)
    const fragment = withPrefix('#', hash)
    const target = `${normalizedBase}${locale}/${query}${fragment}`
    const current = `${pathname}${query}${fragment}`

    return target === current ? null : target
}
