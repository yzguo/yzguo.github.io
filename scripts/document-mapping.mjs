import path from 'node:path'

export const chineseDirName = 'zh-cn'
export const readmeEnglish = 'README.md'
export const readmeChinese = 'README.zh-CN.md'

const cjkPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const chineseLocaleSuffix = /\.zh-cn\.md$/i

export function hasCjk(value) {
  return cjkPattern.test(String(value ?? ''))
}

// Root Markdown files are sources only when their file name explicitly marks
// them as Chinese. A Chinese proper name inside an English-named page is not
// evidence that the page is a Chinese source.
export function rootDocumentTargetName(fileName) {
  if (typeof fileName !== 'string' || !fileName.endsWith('.md')) return null
  if (fileName === readmeEnglish || fileName === readmeChinese) return null
  if (fileName.toLowerCase().endsWith('.en.md')) return null
  if (chineseLocaleSuffix.test(fileName)) {
    return `${fileName.slice(0, -'.zh-CN.md'.length)}.md`
  }
  if (hasCjk(fileName)) {
    return `${fileName.slice(0, -'.md'.length)}.en.md`
  }
  return null
}

export function isRootDocumentTarget(fileName) {
  return typeof fileName === 'string' && fileName.toLowerCase().endsWith('.en.md')
}

export function localizeInternalHref(href) {
  if (typeof href !== 'string') return href
  if (href === '/zh-cn') return '/'
  if (href.startsWith('/zh-cn/')) return href.slice('/zh-cn'.length)
  if (href.startsWith('/zh-cn?') || href.startsWith('/zh-cn#')) {
    return `/${href.slice('/zh-cn'.length)}`
  }
  return href
}

export function isPathInside(parentDir, candidatePath) {
  const relative = path.relative(path.resolve(parentDir), path.resolve(candidatePath))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function normalizeRelativePath(value) {
  return value.split(path.sep).join('/')
}
