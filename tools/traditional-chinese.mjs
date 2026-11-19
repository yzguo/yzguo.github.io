import { Converter } from 'opencc-js'
import {
  collectUnsupported,
  encodeValue,
  hasCjk,
  isPathLikeValue,
  localizeInternalHref,
  parseFrontmatterScalars,
  traditionalDirName
} from './document-model.mjs'
import {
  assertNoPrivateContent,
  assertSafeGeneratedMarkup,
  maskMarkdown,
  restoreMaskedMarkdown,
  sanitizeMarkdownForModel,
  splitMarkdownDocument
} from './markdown-safety.mjs'
import { convertMermaidBlocks, restoreMermaidBlocks } from './mermaid-translate.mjs'
import { projectSemanticText } from './semantic-safe.mjs'

// OpenCC runs as a bundled local dependency. No network request, browser
// service, or external converter endpoint is involved. The Taiwan phrase set
// (`twp`) supplies natural Traditional vocabulary in addition to character
// conversion.
let converter = null

export function convertTextToTraditional(text) {
  if (typeof text !== 'string') throw new TypeError('简繁转换需要字符串')
  if (!converter) converter = Converter({ from: 'cn', to: 'twp' })
  return converter(text)
}

// Returns the first Simplified-only character OpenCC would change, or null
// when every character is already acceptable Traditional script. Character
// inspection is intentional: OpenCC's phrase table also normalizes regional
// wording such as 查看 → 檢視, which is valid Traditional copy and must not be
// rejected as a Simplified-copy marker.
export function findSimplifiedText(text) {
  const characters = [...text]
  for (let index = 0; index < characters.length; index += 1) {
    const simplified = characters[index]
    const traditional = convertTextToTraditional(simplified)
    if (traditional !== simplified) {
      return { index, simplified, traditional }
    }
  }
  return null
}

export function assertTraditionalText(text, label = '繁中内容') {
  const issue = findSimplifiedText(text)
  if (issue) {
    throw new Error(
      `${label}仍含未转换的简体内容「${issue.simplified}」，应为「${issue.traditional}」`
    )
  }
}

// Converts only visible Markdown text. Protected destinations, code, formulas,
// HTML tags, and Mermaid syntax are replaced by local placeholders first; the
// placeholders are restored and validated exactly once afterwards.
export function convertBodyToTraditional(body, options = {}) {
  if (typeof body !== 'string') throw new TypeError('Markdown body must be a string')
  const convertText = options.convertText ?? convertTextToTraditional
  if (typeof convertText !== 'function') throw new TypeError('简繁转换需要 convertText')

  const mermaid = convertMermaidBlocks(body, { convertText })
  const masked = maskMarkdown(mermaid.body, {
    protectPipes: true,
    protectBareUrls: true,
    failOnUnsafeHtml: true,
    targetLocale: traditionalDirName
  })
  const converted = convertText(masked.text)
  const restored = restoreMaskedMarkdown(converted, masked.tokens)
  return restoreMermaidBlocks(restored, mermaid.tokens)
}

export async function convertMarkdownToTraditional(sourceText, options = {}) {
  if (typeof sourceText !== 'string') throw new TypeError('源文件内容必须是字符串')
  const md = options.md
  if (!md || typeof md.parse !== 'function') {
    throw new Error('简繁转换需要 VitePress Markdown 解析器')
  }
  const convertText = options.convertText ?? convertTextToTraditional

  const sanitized = sanitizeMarkdownForModel(sourceText)
  const document = splitMarkdownDocument(sanitized)
  const frontmatter = document.frontmatter === null
    ? null
    : convertFrontmatter(document.frontmatter, {
        convertText,
        targetLocale: traditionalDirName
      })

  let body = convertBodyToTraditional(document.body, { convertText })
  body = body.trim()
  if (body) {
    body = `${body}\n`
    if (document.frontmatter !== null && document.body.startsWith('\n')) {
      body = `\n${body}`
    }
  }

  const traditional = document.frontmatter === null
    ? body
    : `${document.opening}${frontmatter}${document.closing}${body}`
  if (!traditional.trim()) throw new Error('生成的繁中页面为空')

  assertNoPrivateContent(traditional, '生成的繁中页面')
  await assertSafeGeneratedMarkup(sanitized, traditional, '生成的繁中页面', { md })

  const projection = await projectSemanticText(traditional, { md })
  assertTraditionalText(projection.text, '生成的繁中页面')

  return traditional
}

// Deterministic script check shared by the CLI and tests. Code, formulas,
// URLs, and Mermaid syntax are masked by the semantic projection, so only
// visible text is inspected. A byte-for-byte copy of the Simplified page fails
// here unless the page has no Simplified-only characters at all, in which case
// there was nothing to convert.
export async function traditionalTextIssues(targetText, options = {}) {
  const md = options.md
  if (!md || typeof md.parse !== 'function') {
    throw new Error('繁中检查需要 VitePress Markdown 解析器')
  }
  const file = options.file ?? 'page'
  const target = sanitizeMarkdownForModel(targetText)
  const targetProjection = await projectSemanticText(target, { md })
  const issue = findSimplifiedText(targetProjection.text)
  return issue
    ? [`${file}: 繁中页面仍含未转换的简体内容「${issue.simplified}」，应为「${issue.traditional}」`]
    : []
}

export function convertFrontmatter(frontmatter, options = {}) {
  if (typeof frontmatter !== 'string') throw new TypeError('frontmatter 必须是字符串')
  const convertText = options.convertText
  if (typeof convertText !== 'function') {
    throw new TypeError('convertFrontmatter 需要 convertText')
  }
  const targetLocale = options.targetLocale ?? traditionalDirName

  const unsupported = collectUnsupported(frontmatter)
  if (unsupported.length > 0) throw new Error(unsupported.join('；'))

  const { lines, records } = parseFrontmatterScalars(frontmatter)
  const parseErrors = records.filter((record) => record.error)
  if (parseErrors.length > 0) {
    throw new Error(parseErrors.map((record) => `第 ${record.line} 行：${record.error}`).join('；'))
  }

  const byLine = new Map()
  for (const record of records) {
    if (record.localize) {
      byLine.set(record.line, {
        record,
        value: localizeInternalHref(record.value, targetLocale)
      })
      continue
    }
    if (!hasCjk(record.value) || isPathLikeValue(record.value)) continue
    const converted = convertText(record.value)
    if (typeof converted !== 'string' || converted.trim() === '') {
      throw new Error(`第 ${record.line + 1} 行的前置元数据转换结果为空`)
    }
    if (converted.includes('<!--') || /private\s*:/.test(converted)) {
      throw new Error('前置元数据转换结果包含私有内容标记，已拒绝写入')
    }
    byLine.set(record.line, { record, value: converted })
  }

  return lines.map((line, index) => {
    const replacement = byLine.get(index)
    if (!replacement) return line
    const { record, value } = replacement
    const encoded = encodeValue(value, record.quote)
    return `${record.content.slice(0, record.valueStart)}${encoded}${record.content.slice(record.valueEnd)}${record.ending}`
  }).join('')
}
