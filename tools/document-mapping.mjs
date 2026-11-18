import path from 'node:path'

export const englishDirName = 'en'
export const chineseDirName = 'zh-cn'
export const traditionalDirName = 'zh-tw'
export const localeNames = [englishDirName, chineseDirName, traditionalDirName]

export const readmeEnglish = 'README.md'
export const readmeChinese = 'README.zh-CN.md'
export const readmeTraditional = 'README.zh-TW.md'
export const readmeSources = [readmeChinese]
export const readmeTargets = {
  en: readmeEnglish,
  'zh-tw': readmeTraditional
}

const cjkPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const chineseLocaleSuffix = /\.zh-cn\.md$/i
const localizedSuffix = /\.(?:zh-tw|en)\.md$/i
const localePrefixPattern = /^\/(en|zh-cn|zh-tw)(?=$|[/?#])/i

export function hasCjk(value) {
  return cjkPattern.test(String(value ?? ''))
}

// Root Markdown files are sources only when their file name explicitly marks
// them as Simplified Chinese. A Chinese proper name inside an English-named
// page is not evidence that the page is a Chinese source. Traditional and
// English generated files are never sources, even though their names can
// contain Han characters.
export function rootDocumentTargetName(fileName, locale = englishDirName) {
  if (typeof fileName !== 'string' || !fileName.endsWith('.md')) return null
  if (locale !== englishDirName && locale !== traditionalDirName) return null
  if (fileName === readmeEnglish || fileName === readmeChinese || fileName === readmeTraditional) {
    return null
  }
  if (localizedSuffix.test(fileName)) return null
  if (chineseLocaleSuffix.test(fileName)) {
    const base = fileName.slice(0, -'.zh-CN.md'.length)
    return locale === traditionalDirName ? `${base}.zh-TW.md` : `${base}.md`
  }
  if (hasCjk(fileName)) {
    const base = fileName.slice(0, -'.md'.length)
    return locale === traditionalDirName ? `${base}.zh-TW.md` : `${base}.en.md`
  }
  return null
}

export function rootDocumentTargets(fileName) {
  const english = rootDocumentTargetName(fileName, englishDirName)
  if (!english) return null
  return {
    en: english,
    'zh-tw': rootDocumentTargetName(fileName, traditionalDirName)
  }
}

function localeOfPathPrefix(prefix) {
  const normalized = String(prefix ?? '').toLowerCase()
  return normalized === 'en' || normalized === 'zh-tw' ? normalized : chineseDirName
}

// Locale prefixes are presentation details. Semantic comparison, protected
// feature comparison, and generated-content safety checks all compare the same
// route without its /en, /zh-cn, or /zh-tw prefix.
export function canonicalInternalHref(href) {
  if (typeof href !== 'string') return href
  const match = href.match(localePrefixPattern)
  if (!match) return href
  const rest = href.slice(match[0].length)
  if (rest === '') return '/'
  return rest.startsWith('?') || rest.startsWith('#') ? `/${rest}` : rest
}

// Rewrites only site-internal absolute links that already carry a locale
// prefix (or the language-chooser root). Relative links, external URLs, and
// unprefixed public assets are preserved; the checker reports unprefixed page
// routes instead of guessing whether a path is a page or an asset.
const assetExtension = /\.(?:avif|bmp|csv|css|eot|gif|ico|jpe?g|js|json|map|mjs|mp[34]|ogg|otf|pdf|png|svg|tar|ttf|txt|wasm|wav|webp|woff2?|xml|zip)(?=$|[?#])/i

export function localizeInternalHref(href, locale = englishDirName) {
  if (typeof href !== 'string') return href
  const target = localeNames.includes(locale) ? locale : englishDirName
  const localized = localeOfPathPrefix(target)
  const match = href.match(localePrefixPattern)
  if (match) {
    const rest = href.slice(match[0].length)
    if (rest === '') return `/${localized}/`
    const normalized = rest.startsWith('/') ? rest : `/${rest}`
    const pathPart = normalized.split(/[?#]/, 1)[0]
    if (assetExtension.test(pathPart)) return normalized
    return `/${localized}${normalized}`
  }
  if (href === '/') return `/${localized}/`
  return href
}

export function isLocalePrefixedHref(href, locale) {
  if (typeof href !== 'string') return false
  const match = href.match(localePrefixPattern)
  return Boolean(match) && localeOfPathPrefix(match[1]) === locale
}

export function isPathInside(parentDir, candidatePath) {
  const relative = path.relative(path.resolve(parentDir), path.resolve(candidatePath))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function normalizeRelativePath(value) {
  return value.split(path.sep).join('/')
}
