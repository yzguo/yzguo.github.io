import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const docs = path.join(root, 'docs')
const zh = path.join(docs, 'zh-cn')
const errors = []

async function markdownFiles(dir, relative = '') {
  const files = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = path.posix.join(relative, entry.name)
    if (entry.isDirectory()) files.push(...await markdownFiles(path.join(dir, entry.name), rel))
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(rel)
  }
  return files.sort()
}

function structure(text) {
  const withoutComments = text.replace(/<!--[\s\S]*?-->/g, '')
  const headings = [...withoutComments.matchAll(/^\s{0,3}(#{1,6})\s+.+$/gm)].map((m) => m[1].length)
  const fences = [...text.matchAll(/^\s*(`{3,}|~{3,})([^\n]*)$/gm)].map((m) => m[2].trim().split(/\s+/)[0] || 'plain')
  const tables = [...withoutComments.matchAll(/^\|.*\|\s*$/gm)].map((m) => (m[0].match(/(?<!\\)\|/g) || []).length - 1)
  return { headings, fences, tables }
}

const english = await markdownFiles(docs).then((files) => files.filter((f) => !f.startsWith('zh-cn/')))
const chinese = await markdownFiles(zh)
const enSet = new Set(english)
const zhSet = new Set(chinese)

for (const file of english) if (!zhSet.has(file)) errors.push(`Missing Chinese page: docs/zh-cn/${file}`)
for (const file of chinese) if (!enSet.has(file)) errors.push(`Missing English page: docs/${file}`)

for (const file of english) {
  if (!zhSet.has(file)) continue
  const [enText, zhText] = await Promise.all([
    readFile(path.join(docs, file), 'utf8'),
    readFile(path.join(zh, file), 'utf8')
  ])
  const enStructure = structure(enText)
  const zhStructure = structure(zhText)
  for (const key of Object.keys(enStructure)) {
    if (JSON.stringify(enStructure[key]) !== JSON.stringify(zhStructure[key])) {
      errors.push(`${file}: English/Chinese ${key} structure differs`)
    }
  }
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'))
  process.exitCode = 1
} else {
  console.log(`Bilingual check passed: ${english.length} matched Markdown pages and structures.`)
}
