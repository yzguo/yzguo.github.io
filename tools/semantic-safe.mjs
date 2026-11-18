import { canonicalInternalHref } from './document-mapping.mjs'
import { maskMarkdown } from './markdown-protect.mjs'
import { splitMarkdownDocument } from './markdown-privacy.mjs'
import { getMermaidSemanticData } from './mermaid-translate.mjs'

// Converts untrusted Markdown into a model-safe semantic projection. Code,
// formulas, link destinations, HTML URL attributes, and bare URLs are replaced
// by neutral markers before the text leaves the machine. The removed structures
// are compared locally; Mermaid labels remain visible because their meaning is
// part of the page copy, while Mermaid syntax is compared locally.

const urlPattern = /(?:(?:https?|mailto|tel|javascript|data|vbscript|file|about|blob):[^\s<>"'`]+|\/\/[^\s<>"'`]+)/gi
const cssUrlPattern = /url\(\s*(["']?)([^)"']+)\1\s*\)/gi
const linkTargetPattern = /\]\(\s*(?:<([^>]*)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/
const referenceTargetPattern = /^\s*\[[^\]]+\]:\s*(?:<([^>]*)>|(\S+))/
const urlAttributeNames = new Set([
  'action',
  'archive',
  'background',
  'cite',
  'classid',
  'codebase',
  'data',
  'data-href',
  'data-src',
  'data-srcset',
  'data-url',
  'formaction',
  'href',
  'icon',
  'longdesc',
  'manifest',
  'ping',
  'poster',
  'profile',
  'src',
  'srcset',
  'usemap',
  'xlink:href'
])
const multiValueUrlAttributes = new Set(['archive', 'ping', 'srcset', 'data-srcset'])

class SemanticProjectionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SemanticProjectionError'
  }
}

function normalizeTarget(value) {
  let target = String(value).trim()
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1)
  if (!target) return target
  return canonicalInternalHref(target)
}

function addUniqueUrl(features, value) {
  const target = normalizeTarget(value)
  if (target) features.urls.push(target)
}

function extractUrlLike(text, features) {
  for (const match of String(text).matchAll(urlPattern)) {
    addUniqueUrl(features, match[0])
  }
}

function maskUrlLike(text, features) {
  return String(text).replace(urlPattern, (match) => {
    addUniqueUrl(features, match)
    return '[url]'
  })
}

function isUrlAttributeName(name) {
  const normalized = String(name).toLowerCase()
  const bare = normalized.replace(/^(?:v-bind:|:)/, '')
  if (urlAttributeNames.has(bare)) return true
  return normalized.startsWith('data-') && /(?:href|src|srcset|url|background|poster|action)$/.test(normalized)
}

function parseHtmlTag(tag) {
  if (typeof tag !== 'string' || !tag.startsWith('<') || !tag.endsWith('>')) {
    throw new SemanticProjectionError('HTML 标签无法安全解析，已拒绝语义检查')
  }
  const match = tag.match(/^<(\/?)([A-Za-z][A-Za-z0-9:._-]*)([\s\S]*)>$/)
  if (!match) {
    throw new SemanticProjectionError('HTML 标签无法安全解析，已拒绝语义检查')
  }
  const [, closing, name, rest] = match
  if (closing) {
    if (rest.trim() !== '') {
      throw new SemanticProjectionError('HTML 结束标签无法安全解析，已拒绝语义检查')
    }
    return { source: tag, name, rest, attributes: [], closing: true }
  }

  const attributes = []
  let position = 0
  while (position < rest.length) {
    while (position < rest.length && /\s/.test(rest[position])) position += 1
    if (position >= rest.length) break
    if (rest[position] === '/' && rest.slice(position + 1).trim() === '') break

    const nameStart = position
    while (position < rest.length && !/[\s=/>]/.test(rest[position])) position += 1
    if (position === nameStart) {
      throw new SemanticProjectionError('HTML 属性无法安全解析，已拒绝语义检查')
    }
    const attributeName = rest.slice(nameStart, position)
    const nameEnd = position
    while (position < rest.length && /\s/.test(rest[position])) position += 1
    if (rest[position] !== '=') {
      attributes.push({
        name: attributeName,
        nameStart,
        nameEnd,
        hasValue: false,
        quote: null,
        valueStart: null,
        valueEnd: null,
        rawValueEnd: null
      })
      continue
    }

    position += 1
    while (position < rest.length && /\s/.test(rest[position])) position += 1
    if (position >= rest.length) {
      throw new SemanticProjectionError('HTML 属性值无法安全解析，已拒绝语义检查')
    }
    const quote = rest[position] === '"' || rest[position] === "'" ? rest[position] : null
    let valueStart
    let valueEnd
    if (quote) {
      const closingQuote = rest.indexOf(quote, position + 1)
      if (closingQuote === -1) {
        throw new SemanticProjectionError('HTML 属性引号未闭合，已拒绝语义检查')
      }
      valueStart = position + 1
      valueEnd = closingQuote
      position = closingQuote + 1
    } else {
      valueStart = position
      while (
        position < rest.length &&
        !/\s/.test(rest[position]) &&
        !(rest[position] === '/' && rest.slice(position + 1).trim() === '')
      ) {
        position += 1
      }
      valueEnd = position
      if (valueEnd === valueStart) {
        throw new SemanticProjectionError('HTML 属性值为空，已拒绝语义检查')
      }
    }
    attributes.push({
      name: attributeName,
      nameStart,
      nameEnd,
      hasValue: true,
      quote,
      valueStart,
      valueEnd,
      rawValueEnd: quote ? valueEnd + 1 : valueEnd
    })
  }

  return { source: tag, name, rest, attributes, closing: false }
}

function addHtmlAttributeUrls(tag, features) {
  for (const attribute of tag.attributes) {
    if (!attribute.hasValue) continue
    const value = tag.rest.slice(attribute.valueStart, attribute.valueEnd)
    if (isUrlAttributeName(attribute.name)) {
      if (multiValueUrlAttributes.has(attribute.name.toLowerCase().replace(/^(?:v-bind:|:)/, ''))) {
        for (const candidate of value.split(/,|\s+/)) {
          if (candidate) addUniqueUrl(features, candidate)
        }
      } else {
        addUniqueUrl(features, value)
      }
    }
    if (attribute.name.toLowerCase().replace(/^(?:v-bind:|:)/, '') === 'style') {
      extractUrlLike(value, features)
      for (const match of value.matchAll(cssUrlPattern)) addUniqueUrl(features, match[2])
    }
  }
}

function sanitizeHtmlTag(tag, features) {
  const parsed = parseHtmlTag(tag)
  addHtmlAttributeUrls(parsed, features)
  if (parsed.closing) return parsed.source

  let output = `<${parsed.name}`
  let cursor = 0
  for (const attribute of parsed.attributes) {
    output += parsed.rest.slice(cursor, attribute.nameEnd)
    if (!attribute.hasValue) {
      cursor = attribute.nameEnd
      continue
    }
    output += parsed.rest.slice(attribute.nameEnd, attribute.valueStart)
    const value = parsed.rest.slice(attribute.valueStart, attribute.valueEnd)
    const normalizedName = attribute.name.toLowerCase().replace(/^(?:v-bind:|:)/, '')
    if (isUrlAttributeName(attribute.name)) {
      output += '[url]'
    } else if (normalizedName === 'style' && /url\s*\(/i.test(value)) {
      output += '[url]'
    } else {
      output += value
    }
    if (attribute.quote) output += attribute.quote
    cursor = attribute.rawValueEnd
  }
  output += parsed.rest.slice(cursor)
  return `${output}>`
}

function addLinkUrls(value, features) {
  extractUrlLike(value, features)
  const match = value.match(linkTargetPattern)
  if (match) addUniqueUrl(features, match[1] ?? match[2])
  const reference = value.match(referenceTargetPattern)
  if (reference) addUniqueUrl(features, reference[1] ?? reference[2])
}

function maskFrontmatter(frontmatter, features) {
  const pathPattern = /(?<![\w.-])(?:\/(?!\/)[A-Za-z0-9_./#?&=%+-]*|\.\.?\/[^\s"'`]+)/g
  return String(frontmatter).replace(urlPattern, (match) => {
    addUniqueUrl(features, match)
    return '[url]'
  }).replace(pathPattern, (match) => {
    addUniqueUrl(features, match)
    return '[url]'
  })
}

function parseMarkdownBody(body, md) {
  let tokens
  try {
    tokens = md.parse(body, {})
  } catch {
    throw new SemanticProjectionError('Markdown 解析失败，已拒绝语义检查')
  }
  if (!Array.isArray(tokens)) {
    throw new SemanticProjectionError('Markdown 解析结果不确定，已拒绝语义检查')
  }
  if (body.trim() !== '' && tokens.length === 0) {
    throw new SemanticProjectionError('Markdown 解析结果为空，已拒绝语义检查')
  }
  return tokens
}

function replaceProtectedBlocks(body, tokens, features) {
  const lines = body.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const ranges = []
  for (const token of tokens) {
    if (!['code_block', 'fence', 'math_block'].includes(token.type)) continue
    if (!Array.isArray(token.map) || token.map.length !== 2) {
      throw new SemanticProjectionError('Markdown 解析无法定位受保护内容，已拒绝语义检查')
    }
    const [start, end] = token.map
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > lines.length) {
      throw new SemanticProjectionError('Markdown 解析返回了无效的受保护范围，已拒绝语义检查')
    }
    const blockText = lines.slice(start, end).join('')
    if (!blockText) {
      throw new SemanticProjectionError('Markdown 受保护内容为空，已拒绝语义检查')
    }
    const info = token.type === 'fence' ? String(token.info ?? '').trim() : ''
    if (token.type === 'fence' && info.split(/\s+/)[0].toLowerCase() === 'mermaid') {
      const mermaid = getMermaidSemanticData(token.content ?? '')
      features.mermaid.push(`${mermaid.type}\0${mermaid.skeleton}`)
      const labels = mermaid.labels.map((label) => {
        const safeLabel = maskUrlLike(label, features)
        return `- ${safeLabel}`
      })
      ranges.push({
        start,
        end,
        replacement: `[mermaid]\n${labels.join('\n')}\n`
      })
    } else if (token.type === 'math_block') {
      features.math.push(String(token.content ?? blockText))
      ranges.push({ start, end, replacement: '[formula]\n' })
    } else {
      features.code.push(`${info}\0${String(token.content ?? '')}`)
      ranges.push({ start, end, replacement: '[code]\n' })
    }
  }

  ranges.sort((left, right) => left.start - right.start)
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start < ranges[index - 1].end) {
      throw new SemanticProjectionError('Markdown 受保护范围重叠，已拒绝语义检查')
    }
  }

  let output = ''
  let cursor = 0
  for (const range of ranges) {
    output += lines.slice(cursor, range.start).join('')
    output += range.replacement
    cursor = range.end
  }
  return output + lines.slice(cursor).join('')
}

function tokenReplacement(entry, features) {
  const { kind, value } = entry
  if (kind === 'code') {
    features.code.push(`inline\0${value}`)
    return '[code]'
  }
  if (kind === 'math') {
    features.math.push(value)
    return '[formula]'
  }
  if (kind === 'html') {
    return sanitizeHtmlTag(value, features)
  }
  if (kind === 'autolink' || kind === 'url') {
    addUniqueUrl(features, value.replace(/^<|>$/g, ''))
    return '[url]'
  }
  if (kind === 'link-whole' || kind === 'reference-whole') {
    addLinkUrls(value, features)
    return '[link]'
  }
  if (kind === 'reference-definition') {
    addLinkUrls(value, features)
    return '[url]'
  }
  if (kind === 'link' || kind === 'reference') {
    addLinkUrls(value, features)
    return '[url]'
  }
  if (kind === 'fence') {
    features.code.push(`fence\0${value}`)
    return '[code]'
  }
  if (kind === 'pipe') return '|'
  return '[protected]'
}

function applyMaskedTokens(masked, tokens, features) {
  let output = ''
  let cursor = 0
  for (const entry of tokens) {
    const index = masked.indexOf(entry.token, cursor)
    if (index === -1) throw new SemanticProjectionError('Markdown 受保护标记丢失，已拒绝语义检查')
    output += masked.slice(cursor, index)
    output += tokenReplacement(entry, features)
    cursor = index + entry.token.length
  }
  return output + masked.slice(cursor)
}

function maskResidualUrls(text, features) {
  return String(text).replace(urlPattern, (match) => {
    addUniqueUrl(features, match)
    return '[url]'
  })
}

export async function projectSemanticText(text, options = {}) {
  if (typeof text !== 'string') throw new TypeError('语义检查需要 Markdown 文本')
  const md = options.md
  if (!md || typeof md.parse !== 'function') {
    throw new SemanticProjectionError('缺少 VitePress Markdown 解析器，已拒绝语义检查')
  }
  const document = splitMarkdownDocument(text)
  const features = { code: [], math: [], urls: [], mermaid: [] }
  const frontmatter = document.frontmatter === null
    ? ''
    : maskFrontmatter(document.frontmatter, features)
  const tokens = parseMarkdownBody(document.body, md)
  const bodyWithBlocks = replaceProtectedBlocks(document.body, tokens, features)
  const masked = maskMarkdown(bodyWithBlocks, {
    protectBareUrls: true,
    failOnUnsafeHtml: true,
    targetLocale: 'canonical'
  })
  const projectedBody = applyMaskedTokens(masked.text, masked.tokens, features)
  const safeBody = maskResidualUrls(projectedBody, features)
  return {
    text: `${document.opening}${frontmatter}${document.closing}${safeBody}`,
    features
  }
}

function sameArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function compareProtectedFeatures(english, chinese) {
  const errors = []
  const keys = [
    ['code', '代码内容'],
    ['math', '公式内容'],
    ['urls', '链接目标或 URL'],
    ['mermaid', 'Mermaid 结构']
  ]
  for (const [key, label] of keys) {
    const left = [...(english?.[key] ?? [])].sort()
    const right = [...(chinese?.[key] ?? [])].sort()
    if (!sameArray(left, right)) {
      errors.push(`本地受保护${label}不一致，无法交给模型比较`)
    }
  }
  return errors
}
