import { readdir, readFile, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const englishRoot = path.join(root, 'docs')
const chineseRoot = path.join(englishRoot, 'zh-CN')
const errors = []

async function markdownFiles(directory, base = directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'zh-CN' && directory === englishRoot) continue
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await markdownFiles(fullPath, base))
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(path.relative(base, fullPath))
  }
  return files.sort()
}

function structure(markdown) {
  const source = markdown
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*```[\s\S]*?^\s*```\s*$/gm, '')
  const headings = [...source.matchAll(/^ {0,3}(#{1,6})\s+.+$/gm)].map((match) => match[1].length)
  const fences = [...markdown.matchAll(/^\s*(`{3,}|~{3,})([^\n]*)$/gm)]
    .map((match) => match[2].trim().split(/\s+/)[0] || '(plain)')
  const math = (source.match(/\$\$/g) || []).length
  return { headings, fences, math }
}

for (const readme of ['README.md', 'README.zh-CN.md']) {
  try {
    await access(path.join(root, readme))
  } catch {
    errors.push(`Missing separate repository guide: ${readme}`)
  }
}

const englishPages = await markdownFiles(englishRoot)
const chinesePages = await markdownFiles(chineseRoot, chineseRoot)
const enSet = new Set(englishPages)
const zhSet = new Set(chinesePages)

for (const page of englishPages) {
  if (!zhSet.has(page)) errors.push(`Missing Chinese counterpart: docs/zh-CN/${page}`)
}
for (const page of chinesePages) {
  if (!enSet.has(page)) errors.push(`Missing English counterpart: docs/${page}`)
}

for (const page of englishPages) {
  if (!zhSet.has(page)) continue
  const [english, chinese] = await Promise.all([
    readFile(path.join(englishRoot, page), 'utf8'),
    readFile(path.join(chineseRoot, page), 'utf8')
  ])
  const enStructure = structure(english)
  const zhStructure = structure(chinese)
  for (const key of ['headings', 'fences', 'math']) {
    if (JSON.stringify(enStructure[key]) !== JSON.stringify(zhStructure[key])) {
      errors.push(`${page}: English/Chinese ${key} structure differs (${JSON.stringify(enStructure[key])} vs ${JSON.stringify(zhStructure[key])})`)
    }
  }
}

if (errors.length) {
  console.error('Bilingual content check failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log(`Bilingual check passed: ${englishPages.length} paired Markdown pages; headings, code fences, and math delimiters match.`)
}
