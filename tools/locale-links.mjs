import { isLocalePrefixedHref, localeNames } from './document-mapping.mjs'
import { maskMarkdown } from './markdown-protect.mjs'
import { splitMarkdownDocument } from './markdown-privacy.mjs'
import { parseFrontmatterScalars } from './frontmatter-translate.mjs'

const localePattern = /^\/(en|zh-cn|zh-tw)(?=$|[/?#])/i
const assetExtension = /\.(?:avif|bmp|csv|css|eot|gif|ico|jpe?g|js|json|map|mjs|mp[34]|ogg|otf|pdf|png|svg|tar|ttf|txt|wasm|wav|webp|woff2?|xml|zip)(?:[?#]|$)/i
const pathLikeValue = /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/|\.{1,2}\/|#)/

function destinationFromParentheses(value) {
  const match = String(value).match(/^\(\s*(?:<([^>]*)>|([^\s)]+))/)
  return match ? (match[1] ?? match[2] ?? '') : ''
}

function destinationFromReferenceDefinition(value) {
  const match = String(value).match(/^\s*\[[^\]]+\]:\s*(?:<([^>]*)>|(\S+))/)
  return match ? (match[1] ?? match[2] ?? '') : ''
}

function destinationsFromWholeLink(value) {
  const text = String(value)
  const index = text.lastIndexOf('](')
  if (index === -1) return []
  return [destinationFromParentheses(text.slice(index + 1))]
}
function destinationsFromSrcset(value) {
  const text = String(value)
  const destinations = []
  let index = 0
  while (index < text.length) {
    while (index < text.length && /[\s,]/.test(text[index])) index += 1
    const start = index
    while (index < text.length && !/\s/.test(text[index])) index += 1
    const raw = text.slice(start, index)
    const target = raw.replace(/,+$/, '')
    if (target) destinations.push(target)
    if (target.length !== raw.length) continue
    while (index < text.length && text[index] !== ',') index += 1
    if (index < text.length) index += 1
  }
  return destinations
}


function destinationsFromHtml(tag) {
  const destinations = []
  const attributes = /\b(href|src|srcset|action|formaction)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
  let match
  while ((match = attributes.exec(tag)) !== null) {
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    if (match[1].toLowerCase() === 'srcset') destinations.push(...destinationsFromSrcset(value))
    else destinations.push(value)
  }
  const css = /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi
  while ((match = css.exec(tag)) !== null) destinations.push(match[2])
  return destinations
}

function frontmatterDestinations(frontmatter) {
  if (!frontmatter) return []
  const destinations = []
  const { records } = parseFrontmatterScalars(frontmatter)
  for (const record of records) {
    if (record.error || typeof record.value !== 'string') continue
    if (record.key?.toLowerCase() === 'srcset') {
      destinations.push(...destinationsFromSrcset(record.value))
    } else if (pathLikeValue.test(record.value)) {
      destinations.push(record.value)
    }
  }
  return destinations
}

// Collects site-internal destinations from Markdown without executing or
// rendering the page. Code fences, inline code, formulas, and reference labels
// are masked by the same local parser used for translation, so links in code
// examples are never treated as navigation.
export function collectLocaleLinkTargets(text) {
  if (typeof text !== 'string') throw new TypeError('Markdown text must be a string')
  const document = splitMarkdownDocument(text)
  const masked = maskMarkdown(document.body, {
    protectBareUrls: true,
    failOnUnsafeHtml: true,
    targetLocale: null
  })
  const targets = frontmatterDestinations(document.frontmatter)

  for (const entry of masked.tokens) {
    if (entry.kind === 'link') {
      targets.push(destinationFromParentheses(entry.value))
    } else if (entry.kind === 'reference-definition') {
      targets.push(destinationFromReferenceDefinition(entry.value))
    } else if (entry.kind === 'link-whole') {
      targets.push(...destinationsFromWholeLink(entry.value))
    } else if (entry.kind === 'html') {
      targets.push(...destinationsFromHtml(entry.value))
    } else if (entry.kind === 'autolink' || entry.kind === 'url') {
      targets.push(entry.value.replace(/^<|>$/g, ''))
    }
  }

  return targets.filter((target) => typeof target === 'string' && target !== '')
}

export function isAssetTarget(target) {
  const pathPart = String(target).split(/[?#]/, 1)[0]
  return assetExtension.test(pathPart)
}

function checkDestination(target, locale) {
  if (typeof target !== 'string') return null
  const value = target.trim().replace(/^<|>$/g, '')
  if (!value.startsWith('/') || value.startsWith('//')) return null

  const pathPart = value.split(/[?#]/, 1)[0]
  if (pathPart === '' || pathPart === '/') return null

  const match = value.match(localePattern)
  if (match) {
    return isLocalePrefixedHref(value, locale)
      ? null
      : `站内链接 ${value} 的语言前缀与 /${locale}/ 不一致`
  }

  if (isAssetTarget(value)) return null
  return `站内页面链接必须指向 /${locale}/：${value}`
}

export function localeTargetIssue(target, locale) {
  if (!localeNames.includes(locale)) {
    return `不支持的语言 ${JSON.stringify(locale)}`
  }
  return checkDestination(target, locale)
}

export function localeLinkIssues(text, locale, label = 'page') {
  if (!localeNames.includes(locale)) {
    return [`${label}: 不支持的语言 ${JSON.stringify(locale)}`]
  }

  let targets
  try {
    targets = collectLocaleLinkTargets(text)
  } catch (error) {
    return [`${label}: 无法解析站内链接：${error.message}`]
  }

  const issues = []
  for (const target of targets) {
    const issue = checkDestination(target, locale)
    if (issue) issues.push(`${label}: ${issue}`)
  }
  return issues
}
