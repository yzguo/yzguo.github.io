import { createMarkdownRenderer } from 'vitepress'
import { canonicalInternalHref } from './document-mapping.mjs'

// Deterministic post-model validation using the same VitePress Markdown parser
// that renders the site. Code and math tokens are trusted original content;
// text, HTML, links, images, frontmatter, Vue interpolation, and template
// directives are inspected. Parse uncertainty fails closed.

const dangerousTags = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'meta',
  'link',
  'base',
  'style',
  'svg'
])

let defaultParserPromise = null

async function parserFor(options) {
  let candidate
  try {
    if (options.md) candidate = options.md
    else {
      if (!defaultParserPromise) {
        defaultParserPromise = createMarkdownRenderer(process.cwd(), { math: true }, '/')
      }
      candidate = defaultParserPromise
    }
    const md = await candidate
    if (!md || typeof md.parse !== 'function') {
      throw new Error('renderer did not expose parse()')
    }
    return md
  } catch (error) {
    throw new Error(`无法初始化 VitePress Markdown 安全解析器：${error.code ?? error.message}`)
  }
}

function parseDocument(text, md, context) {
  const env = {}
  let tokens
  try {
    tokens = md.parse(text, env)
  } catch {
    throw new Error(`${context} Markdown 安全解析失败，已拒绝写入`)
  }
  if (!Array.isArray(tokens)) {
    throw new Error(`${context} Markdown 解析结果不确定，已拒绝写入`)
  }
  if (String(text).trim() !== '' && tokens.length === 0) {
    throw new Error(`${context} Markdown 解析结果为空，已拒绝写入`)
  }
  return { tokens, frontmatter: env.frontmatter ?? {} }
}

function decodeEntities(value) {
  let result = value
  for (let pass = 0; pass < 3; pass += 1) {
    result = result
      .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => {
        try {
          return String.fromCodePoint(Number.parseInt(hex, 16))
        } catch {
          return ''
        }
      })
      .replace(/&#([0-9]+);?/g, (_, digits) => {
        try {
          return String.fromCodePoint(Number.parseInt(digits, 10))
        } catch {
          return ''
        }
      })
      .replace(/&colon;/gi, ':')
      .replace(/&sol;/gi, '/')
      .replace(/&amp;/gi, '&')
  }
  return result
}

function normalizeUrl(value) {
  let url = String(value ?? '').trim()
  if (url.startsWith('<') && url.endsWith('>')) url = url.slice(1, -1)
  url = decodeEntities(url).replace(/[\u0000-\u001f\u007f\s]+/g, '')
  return canonicalInternalHref(url)
}

function dangerousUrl(value) {
  const url = normalizeUrl(value).toLowerCase()
  return /^(?:javascript|vbscript|file|about|blob|data):/.test(url)
}

function normalizeTag(tag) {
  return tag.replace(
    /(\b(?:href|src|action|formaction)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (match, prefix, doubleQuoted, singleQuoted, bare) => {
      const value = doubleQuoted ?? singleQuoted ?? bare ?? ''
      return `${prefix}${normalizeUrl(value)}`
    }
  )
}

function hasEventAttribute(tag) {
  return /[\s/"'`]on[a-z0-9_-]+\s*=/i.test(tag)
}

function tagName(tag) {
  return tag.match(/^<\/?([A-Za-z0-9-]+)/)?.[1]?.toLowerCase() ?? ''
}

function addFeature(map, value) {
  if (!value) return
  map.set(value, (map.get(value) ?? 0) + 1)
}

function fenceLanguage(info) {
  return String(info ?? '').trim().split(/\s+/)[0].replace(/\{.*$/, '').toLowerCase()
}

function addProtected(features, type, info, content) {
  addFeature(features.protected, `${type}\u0000${info}\u0000${String(content ?? '')}`)
}

function newFeature(generated, source, message, context) {
  for (const [value, count] of generated) {
    if (count > (source.get(value) ?? 0)) {
      throw new Error(`${context} 包含模型${message}，已拒绝写入`)
    }
  }
}

function sameFeatureMaps(left, right) {
  if (left.size !== right.size) return false
  for (const [value, count] of left) {
    if ((right.get(value) ?? 0) !== count) return false
  }
  return true
}

function extractTags(text) {
  const tags = []
  const withoutComments = text.replace(/<!--[\s\S]*?-->/g, '')
  const pattern = /<\/?[A-Za-z][^>]*>/g
  let match
  while ((match = pattern.exec(withoutComments)) !== null) tags.push(match[0])
  return tags
}

function extractInterpolations(text) {
  const expressions = []
  const pattern = /\{\{([\s\S]*?)\}\}/g
  let match
  while ((match = pattern.exec(text)) !== null) expressions.push(match[1].trim())
  return expressions
}

function extractDirectives(text) {
  const directives = []
  const longForm = /\b(v-[a-z0-9-]+)\b/gi
  let match
  while ((match = longForm.exec(text)) !== null) directives.push(match[1].toLowerCase())
  const shorthand = /(?:^|[\s])([:@#][a-z0-9_-]+)\s*=/gi
  while ((match = shorthand.exec(text)) !== null) directives.push(match[1].toLowerCase())
  return directives
}

function extractTagDestinations(tag) {
  const destinations = []
  const attrs = /\b(?:href|src|action|formaction)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
  let match
  while ((match = attrs.exec(tag)) !== null) destinations.push(match[1] ?? match[2] ?? match[3] ?? '')
  const css = /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi
  while ((match = css.exec(tag)) !== null) destinations.push(match[2])
  return destinations
}

function extractBareUrls(text) {
  const urls = []
  const web = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi
  let match
  while ((match = web.exec(text)) !== null) urls.push(match[0])
  const dangerous = /\b(?:javascript|vbscript|data|file|about|blob):[^\s<>"'`)\]]*/gi
  while ((match = dangerous.exec(text)) !== null) urls.push(match[0])
  const protocolRelative = /(?:^|[\s("'=])(\/\/[^\s<>"'`)\]]+)/g
  while ((match = protocolRelative.exec(text)) !== null) urls.push(match[1])
  return urls
}

function addAttributeExpressions(features, value) {
  if (typeof value !== 'string') return
  for (const expression of extractInterpolations(value)) addFeature(features.interpolations, expression)
  for (const directive of extractDirectives(value)) addFeature(features.directives, directive)
}

function addTag(features, tag) {
  const normalized = normalizeTag(tag)
  addFeature(features.tags, normalized)
  features.rawTags.push(tag)
  addAttributeExpressions(features, tag)
  for (const destination of extractTagDestinations(tag)) addFeature(features.urls, normalizeUrl(destination))
}

function addText(features, text, { directives = false } = {}) {
  for (const tag of extractTags(text)) addTag(features, tag)
  for (const expression of extractInterpolations(text)) addFeature(features.interpolations, expression)
  if (directives) {
    for (const directive of extractDirectives(text)) addFeature(features.directives, directive)
  }
  const decodedText = decodeEntities(text)
  for (const url of extractBareUrls(text)) addFeature(features.urls, normalizeUrl(url))
  for (const url of extractBareUrls(decodedText)) addFeature(features.urls, normalizeUrl(url))
}

function addHtml(features, html) {
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, '')
  for (const expression of extractInterpolations(cleaned)) addFeature(features.interpolations, expression)
  const tags = extractTags(cleaned)
  for (const tag of tags) addTag(features, tag)
  // Bare URLs outside tags still matter as visible text; tags are removed first
  // so attribute URLs are counted once through addTag.
  let text = cleaned
  for (const tag of tags) text = text.replace(tag, ' ')
  addText(features, text)
}

function tokenAttr(token, name) {
  if (typeof token.attrGet === 'function') return token.attrGet(name)
  if (Array.isArray(token.attrs)) {
    const found = token.attrs.find((entry) => Array.isArray(entry) && entry[0] === name)
    return found?.[1]
  }
  return null
}

function collectTokens(features, tokens, context) {
  for (const token of tokens) {
    if (!token || typeof token !== 'object') {
      throw new Error(`${context} Markdown token 不确定，已拒绝写入`)
    }
    switch (token.type) {
      case 'fence':
        // Mermaid labels are translated under a separate, structural validator.
        if (fenceLanguage(token.info) !== 'mermaid') {
          addProtected(features, 'fence', String(token.info ?? ''), token.content)
        }
        break
      case 'code_block':
        addProtected(features, 'code_block', '', token.content)
        break
      case 'code_inline':
        addProtected(features, 'code_inline', '', token.content)
        break
      case 'math_block':
        addProtected(features, 'math_block', '', token.content)
        break
      case 'math_inline':
        addProtected(features, 'math_inline', '', token.content)
        break
      case 'inline':
        if (!Array.isArray(token.children)) {
          throw new Error(`${context} Markdown 行内 token 不确定，已拒绝写入`)
        }
        collectTokens(features, token.children, context)
        break
      case 'text':
        addText(features, String(token.content ?? ''))
        break
      case 'html_inline':
      case 'html_block':
        addHtml(features, String(token.content ?? ''))
        break
      case 'link_open': {
        // VitePress injects a header-anchor link around every heading. Its
        // fragment follows the translated heading text and is not model-authored.
        if (/\bheader-anchor\b/.test(String(tokenAttr(token, 'class') ?? ''))) break
        const href = tokenAttr(token, 'href')
        if (href !== null && href !== undefined) {
          addFeature(features.urls, normalizeUrl(href))
          addAttributeExpressions(features, href)
        }
        break
      }
      case 'image': {
        const src = tokenAttr(token, 'src')
        if (src !== null && src !== undefined) {
          addFeature(features.urls, normalizeUrl(src))
          addAttributeExpressions(features, src)
        }
        addText(features, String(token.content ?? ''))
        break
      }
      default:
        if (typeof token.type === 'string' && token.type.startsWith('math_')) {
          addProtected(features, token.type, '', token.content)
        } else if (Array.isArray(token.children)) collectTokens(features, token.children, context)
        else if (typeof token.content === 'string' && token.content !== '') {
          addText(features, token.content)
        }
    }
  }
}

function collectFrontmatter(features, value, context, seen = new Set()) {
  if (typeof value === 'string') {
    addHtml(features, value)
    for (const directive of extractDirectives(value)) addFeature(features.directives, directive)
    return
  }
  if (value === null || value === undefined || typeof value !== 'object') return
  if (seen.has(value)) throw new Error(`${context} frontmatter 结构不确定，已拒绝写入`)
  seen.add(value)
  if (Array.isArray(value)) {
    for (const entry of value) collectFrontmatter(features, entry, context, seen)
    return
  }
  for (const entry of Object.values(value)) collectFrontmatter(features, entry, context, seen)
}

async function collectFeatures(text, options, context) {
  const md = await parserFor(options)
  const parsed = parseDocument(text, md, context)
  const features = {
    tags: new Map(),
    interpolations: new Map(),
    directives: new Map(),
    urls: new Map(),
    protected: new Map(),
    rawTags: []
  }
  collectTokens(features, parsed.tokens, context)
  collectFrontmatter(features, parsed.frontmatter, context)
  return features
}

export async function assertSafeGeneratedMarkup(source, generated, context = '生成内容', options = {}) {
  if (typeof source !== 'string' || typeof generated !== 'string') {
    throw new TypeError('安全校验需要源文本和生成文本')
  }
  const sourceFeatures = await collectFeatures(source, options, `${context}（源）`)
  const generatedFeatures = await collectFeatures(generated, options, context)

  for (const url of generatedFeatures.urls.keys()) {
    if (dangerousUrl(url)) {
      throw new Error(`${context} 包含不安全的 URL 协议，已拒绝写入`)
    }
  }

  for (const tag of generatedFeatures.rawTags) {
    if (hasEventAttribute(tag)) {
      throw new Error(`${context} 包含模型新增的事件属性，已拒绝写入`)
    }
    if (dangerousTags.has(tagName(tag))) {
      throw new Error(`${context} 包含不安全的 HTML 标签 <${tagName(tag)}>，已拒绝写入`)
    }
    for (const destination of extractTagDestinations(tag)) {
      if (dangerousUrl(destination)) {
        throw new Error(`${context} 包含不安全的 URL 协议，已拒绝写入`)
      }
    }
  }

  if (!sameFeatureMaps(generatedFeatures.protected, sourceFeatures.protected)) {
    throw new Error(`${context} 的代码/公式 token 与原文不一致，已拒绝写入`)
  }

  newFeature(generatedFeatures.tags, sourceFeatures.tags, '新增的 HTML 标签', context)
  newFeature(generatedFeatures.interpolations, sourceFeatures.interpolations, '新增的 Vue 插值', context)
  newFeature(generatedFeatures.directives, sourceFeatures.directives, '新增的模板指令', context)
  newFeature(generatedFeatures.urls, sourceFeatures.urls, '新增或改写的链接目标', context)
}
