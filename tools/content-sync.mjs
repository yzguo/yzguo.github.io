import { createHash } from 'node:crypto'
import { lstat, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertSafeDirectory,
  assertSafePath,
  chineseDirName,
  englishDirName,
  isPathInside,
  normalizeRelativePath,
  parseFrontmatterScalars,
  readSafeMarkdownSource,
  resolveRealRoot,
  traditionalDirName
} from './document-model.mjs'
import {
  getMarkdownParser,
  sanitizeMarkdownForModel,
  splitMarkdownDocument
} from './markdown-safety.mjs'
import {
  translateSource,
  writeTranslationsAtomically
} from './translate-docs.mjs'
import { DEFAULT_TIMEOUT_MS, sanitizeModelError } from './ai-model.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const defaultRootDir = path.resolve(here, '..')
const stateRelativePath = 'tools/content-sync-state.json'
const stateVersion = 1
const targetLocales = [englishDirName, traditionalDirName]
const docsSourceDirectory = `docs/${chineseDirName}`
const skippedDirectories = new Set(['.git', '.vitepress', 'node_modules', 'public', 'dist'])
const hashPattern = /^sha256:[0-9a-f]{64}$/

function truncateError(error, maxLength = 2_000) {
  return sanitizeModelError(error?.message ?? error ?? '未知错误', maxLength)
}

function stableContentHash(text) {
  const normalized = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  return `sha256:${createHash('sha256').update(normalized, 'utf8').digest('hex')}`
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

async function pathKind(targetPath) {
  try {
    const info = await lstat(targetPath)
    if (info.isSymbolicLink()) return { kind: 'symlink', info }
    if (info.isFile()) return { kind: 'file', info }
    return { kind: 'other', info }
  } catch (error) {
    if (error.code === 'ENOENT') return { kind: 'missing', info: null }
    throw error
  }
}

async function listMarkdownFiles(dir, relative = '', errors = []) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) {
      errors.push(`中文文档路径含符号链接或 junction，拒绝继续：${rel}`)
      continue
    }
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name) && !entry.name.startsWith('.')) {
        files.push(...await listMarkdownFiles(path.join(dir, entry.name), rel, errors))
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(rel)
    }
  }
  return files.sort()
}

async function collectDocsSources(rootDir) {
  const docsDir = path.join(rootDir, 'docs', chineseDirName)
  const sources = []
  const errors = []
  let files
  try {
    files = await listMarkdownFiles(docsDir, '', errors)
  } catch (error) {
    errors.push(
      error.code === 'ENOENT'
        ? `缺少 ${docsSourceDirectory} 中文文档目录`
        : `无法读取 ${docsSourceDirectory}：${truncateError(error)}`
    )
    return { sources, errors }
  }

  const docsRoot = path.join(rootDir, 'docs')
  for (const relative of files) {
    const sourcePath = `${docsSourceDirectory}/${relative}`
    const sourceFsPath = path.join(docsRoot, chineseDirName, relative)
    const targets = [
      {
        locale: englishDirName,
        targetPath: `docs/${englishDirName}/${relative}`,
        targetFsPath: path.join(docsRoot, englishDirName, relative)
      },
      {
        locale: traditionalDirName,
        targetPath: `docs/${traditionalDirName}/${relative}`,
        targetFsPath: path.join(docsRoot, traditionalDirName, relative)
      }
    ]
    if (!isPathInside(rootDir, sourceFsPath)) {
      errors.push(`中文源越出仓库目录：${sourcePath}`)
      continue
    }
    if (targets.some((target) => !isPathInside(rootDir, target.targetFsPath))) {
      errors.push(`中文源目标越出仓库目录：${sourcePath}`)
      continue
    }
    sources.push({
      kind: 'docs',
      sourcePath,
      sourceFsPath,
      targets
    })
  }
  sources.sort((left, right) => compareText(left.sourcePath, right.sourcePath))
  return { sources, errors }
}

async function readTargetSnapshot(rootDir, targetFsPath, fs = {}) {
  const safeTarget = await assertSafePath(rootDir, targetFsPath, {
    allowMissing: true,
    requireFile: false,
    label: '目标页面',
    fs
  })
  const kind = await pathKind(safeTarget)
  if (kind.kind === 'symlink') throw new Error('目标页面是符号链接，拒绝覆盖')
  if (kind.kind === 'other') throw new Error('目标页面不是普通文件，拒绝覆盖')
  if (kind.kind === 'missing') {
    return {
      targetFsPath: safeTarget,
      exists: false,
      content: null,
      hash: null,
      original: { exists: false, content: null, mode: 0o666 }
    }
  }

  let content
  try {
    content = await readSafeMarkdownSource(safeTarget, { rootDir, fs })
  } catch (error) {
    throw new Error(`无法安全读取目标页面：${truncateError(error)}`)
  }
  return {
    targetFsPath: safeTarget,
    exists: true,
    content,
    hash: stableContentHash(content),
    original: {
      exists: true,
      content,
      mode: kind.info.mode & 0o777
    }
  }
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('状态清单必须是 JSON 对象')
  }
  if (manifest.version !== stateVersion) {
    throw new Error(`状态清单版本不受支持：${String(manifest.version)}（期望 ${stateVersion}）`)
  }
  if (!manifest.pages || typeof manifest.pages !== 'object' || Array.isArray(manifest.pages)) {
    throw new Error('状态清单缺少 pages 对象')
  }
  for (const [sourcePath, entry] of Object.entries(manifest.pages)) {
    if (normalizeRelativePath(sourcePath) !== sourcePath) {
      throw new Error(`状态清单的源路径不是规范相对路径：${sourcePath}`)
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`状态清单条目不是对象：${sourcePath}`)
    }
    if (typeof entry.sourceHash !== 'string' || !hashPattern.test(entry.sourceHash)) {
      throw new Error(`状态清单源哈希无效：${sourcePath}`)
    }
    if (entry.autoIndex !== undefined && typeof entry.autoIndex !== 'boolean') {
      throw new Error(`状态清单 autoIndex 标记无效：${sourcePath}`)
    }
    if (!entry.targets || typeof entry.targets !== 'object' || Array.isArray(entry.targets)) {
      throw new Error(`状态清单缺少目标记录：${sourcePath}`)
    }
    for (const [locale, target] of Object.entries(entry.targets)) {
      if (!targetLocales.includes(locale)) {
        throw new Error(`状态清单包含不支持的语言：${locale}`)
      }
      if (!target || typeof target !== 'object' || Array.isArray(target)) {
        throw new Error(`状态清单目标记录不是对象：${sourcePath} (${locale})`)
      }
      if (typeof target.path !== 'string' || normalizeRelativePath(target.path) !== target.path) {
        throw new Error(`状态清单目标路径无效：${sourcePath} (${locale})`)
      }
      if (typeof target.hash !== 'string' || !hashPattern.test(target.hash)) {
        throw new Error(`状态清单目标哈希无效：${sourcePath} (${locale})`)
      }
      if (typeof target.sourceHash !== 'string' || !hashPattern.test(target.sourceHash)) {
        throw new Error(`状态清单目标源哈希无效：${sourcePath} (${locale})`)
      }
    }
  }
}

async function readStateManifest(rootDir, fs = {}) {
  const stateFsPath = path.join(rootDir, stateRelativePath)
  const safeState = await assertSafePath(rootDir, stateFsPath, {
    allowMissing: true,
    requireFile: false,
    label: '状态清单',
    fs
  })
  const kind = await pathKind(safeState)
  if (kind.kind === 'symlink') throw new Error('状态清单是符号链接，拒绝读取或覆盖')
  if (kind.kind === 'other') throw new Error('状态清单不是普通文件，拒绝读取或覆盖')
  if (kind.kind === 'missing') {
    return {
      exists: false,
      fsPath: safeState,
      content: null,
      manifest: null,
      original: { exists: false, content: null, mode: 0o666 }
    }
  }

  let content
  try {
    content = await readSafeMarkdownSource(safeState, { rootDir, fs })
  } catch (error) {
    throw new Error(`无法安全读取状态清单：${truncateError(error)}`)
  }
  let manifest
  try {
    manifest = JSON.parse(content)
  } catch {
    throw new Error('状态清单不是有效 JSON；已中止且未写入任何文件')
  }
  validateManifest(manifest)
  return {
    exists: true,
    fsPath: safeState,
    content,
    manifest,
    original: {
      exists: true,
      content,
      mode: kind.info.mode & 0o777
    }
  }
}

function serializeManifest(manifest) {
  const pages = {}
  for (const sourcePath of Object.keys(manifest.pages).sort(compareText)) {
    const entry = manifest.pages[sourcePath]
    const targets = {}
    for (const locale of targetLocales) {
      if (!entry.targets[locale]) continue
      const target = entry.targets[locale]
      targets[locale] = {
        path: target.path,
        hash: target.hash,
        sourceHash: target.sourceHash
      }
    }
    pages[sourcePath] = {
      sourceHash: entry.sourceHash,
      ...(entry.autoIndex ? { autoIndex: true } : {}),
      targets
    }
  }
  return `${JSON.stringify({ version: stateVersion, pages }, null, 2)}\n`
}

function matchesManifestContent(existing, serialized) {
  return typeof existing === 'string' &&
    existing.replace(/\r\n?/g, '\n') === serialized
}

function targetKey(sourcePath, locale) {
  return `${sourcePath}\u0000${locale}`
}

async function getTargetState({
  source,
  target,
  rootDir,
  fs,
  cache,
  errors
}) {
  const key = targetKey(source.sourcePath, target.locale)
  if (cache.has(key)) return cache.get(key)
  try {
    const state = await readTargetSnapshot(rootDir, target.targetFsPath, fs)
    cache.set(key, state)
    return state
  } catch (error) {
    errors.push(`${target.targetPath}：${truncateError(error)}`)
    cache.set(key, null)
    return null
  }
}

function classifyTarget({ sourceHash, manifestEntry, target, state }) {
  const recorded = manifestEntry?.targets?.[target.locale]
  if (recorded && recorded.path !== target.targetPath) {
    return {
      action: 'blocked',
      reason: `状态清单记录的目标路径是 ${recorded.path}，与当前映射 ${target.targetPath} 不一致`
    }
  }

  if (!state.exists) {
    if (!recorded) return { action: 'create', reason: null }
    return { action: 'regenerate', reason: null }
  }

  if (!recorded) {
    return {
      action: 'blocked',
      reason: '目标已存在，但状态清单没有可信基线；拒绝覆盖人工内容'
    }
  }
  if (recorded.hash !== state.hash) {
    return {
      action: 'blocked',
      reason: '目标内容与状态清单哈希不一致（可能被人工编辑）；拒绝覆盖'
    }
  }
  if (
    !manifestEntry ||
    manifestEntry.sourceHash !== sourceHash ||
    recorded.sourceHash !== sourceHash
  ) {
    return { action: 'update', reason: null }
  }
  return { action: 'unchanged', reason: null }
}

function planPage({ source, sourceText, manifestEntry, targetStates, targets: selectedTargets }) {
  const sourceHash = stableContentHash(sourceText)
  const targets = selectedTargets.map((target) => {
    const state = targetStates.get(targetKey(source.sourcePath, target.locale))
    const classification = classifyTarget({
      sourceHash,
      manifestEntry,
      target,
      state
    })
    return {
      ...target,
      state,
      recorded: manifestEntry?.targets?.[target.locale] ?? null,
      action: classification.action,
      reason: classification.reason
    }
  })

  const blocked = targets.filter((target) => target.action === 'blocked')
  if (blocked.length > 0) {
    return {
      source,
      sourceText,
      sourceHash,
      manifestEntry,
      targets,
      status: 'blocked',
      generatedTargets: []
    }
  }

  const generatedTargets = targets.filter((target) => target.action !== 'unchanged')
  if (generatedTargets.length === 0) {
    return {
      source,
      sourceText,
      sourceHash,
      manifestEntry,
      targets,
      status: source.autoIndex || source.autoIndexRefresh ? 'repair' : 'unchanged',
      generatedTargets
    }
  }

  let status
  if (!manifestEntry) status = 'create'
  else if (targets.some((target) => target.action === 'update')) status = 'update'
  else status = 'repair'
  return {
    source,
    sourceText,
    sourceHash,
    manifestEntry,
    targets,
    status,
    generatedTargets
  }
}

async function buildBaseline({
  sources,
  sourceTexts,
  manifest,
  rootDir,
  fs,
  targetStates,
  errors
}) {
  let baselined = 0
  for (const source of sources) {
    if (source.autoIndex) continue
    const sourceText = sourceTexts.get(source.sourcePath)
    if (typeof sourceText !== 'string') continue
    const states = []
    for (const target of source.targets) {
      states.push(await getTargetState({
        source,
        target,
        rootDir,
        fs,
        cache: targetStates,
        errors
      }))
    }
    if (errors.length > 0) return baselined
    if (!states.every((state) => state?.exists)) continue
    const sourceHash = stableContentHash(sourceText)
    const entry = { sourceHash, targets: {} }
    for (const target of source.targets) {
      const state = targetStates.get(targetKey(source.sourcePath, target.locale))
      if (!state?.exists || !state.hash) continue
      entry.targets[target.locale] = {
        path: target.targetPath,
        hash: state.hash,
        sourceHash
      }
    }
    if (Object.keys(entry.targets).length !== source.targets.length) continue
    manifest.pages[source.sourcePath] = entry
    baselined += 1
  }
  return baselined
}

function readHeaderTitle(text, fallback) {
  try {
    const document = splitMarkdownDocument(text)
    if (document.frontmatter !== null) {
      const { records } = parseFrontmatterScalars(document.frontmatter)
      const title = records.find((record) =>
        !record.error &&
        String(record.key ?? '').toLowerCase() === 'title' &&
        typeof record.value === 'string' &&
        record.value.trim() !== ''
      )
      if (title) return cleanLabel(title.value, fallback)
    }
    const heading = document.body.match(/^ {0,3}#[ \t]+([^\r\n]+?)[ \t]*\r?$/m)
    if (heading) return cleanLabel(heading[1], fallback)
  } catch {
    // The page itself will fail its own safe read or translation check later;
    // navigation still gets a deterministic fallback label.
  }
  return fallback
}

function cleanLabel(value, fallback) {
  let text
  try {
    text = sanitizeMarkdownForModel(String(value))
  } catch {
    text = String(value)
  }
  text = text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[`*_~]/g, '')
    .replace(/[\[\]\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text || fallback
}

function linkPath(relative) {
  return `/${chineseDirName}/${relative.split('/').map((part) => encodeURIComponent(part)).join('/')}`
}

function createIndexMarkdown(folderTitle, entries, notesSection = false) {
  const title = cleanLabel(folderTitle, '目录')
  if (notesSection) {
    return `# ${title}\n\n<NotesIndex />\n`
  }
  const lines = [
    `# ${title}`,
    '',
    '本目录包含以下页面：',
    ''
  ]
  for (const entry of entries) {
    lines.push(`- [${cleanLabel(entry.title, entry.fallback)}](${entry.link})`)
  }
  return `${lines.join('\n')}\n`
}

async function discoverAutoIndexes({ rootDir, sources, sourceTexts, manifest }) {
  const files = sources.map((source) =>
    source.sourcePath.slice(`${docsSourceDirectory}/`.length)
  )
  const fileSet = new Set(files)
  const directorySet = new Set()
  for (const file of files) {
    const parent = path.posix.dirname(file)
    if (parent === '.') continue
    const parts = parent.split('/')
    for (let index = 0; index < parts.length; index += 1) {
      directorySet.add(parts.slice(0, index + 1).join('/'))
    }
  }

  const sourceByPath = new Map(sources.map((source) => [source.sourcePath, source]))
  const generated = []
  for (const directory of [...directorySet].sort(compareText)) {
    const directFiles = files.filter((file) =>
      path.posix.dirname(file) === directory && path.posix.basename(file) !== 'index.md'
    )
    const directDirectories = [...directorySet].filter((candidate) =>
      candidate !== directory && path.posix.dirname(candidate) === directory
    ).sort(compareText)

    const entries = []
    for (const child of directDirectories) {
      const childIndex = `${docsSourceDirectory}/${child}/index.md`
      const fallback = path.posix.basename(child)
      entries.push({
        title: sourceTexts.has(childIndex)
          ? readHeaderTitle(sourceTexts.get(childIndex), fallback)
          : fallback,
        fallback,
        link: `${linkPath(child)}/`
      })
    }
    for (const file of directFiles.sort(compareText)) {
      const fallback = path.posix.basename(file, '.md')
      entries.push({
        title: readHeaderTitle(sourceTexts.get(`${docsSourceDirectory}/${file}`), fallback),
        fallback,
        link: linkPath(file.replace(/\.md$/, ''))
      })
    }

    const relativeSource = `${directory}/index.md`
    const sourcePath = `${docsSourceDirectory}/${relativeSource}`
    const content = createIndexMarkdown(
      path.posix.basename(directory) || '目录',
      entries,
      directory === 'Notes' || directory.startsWith('Notes/')
    )

    if (fileSet.has(relativeSource)) {
      // Refresh only indexes this tool created and the user has not edited
      // since. A changed hash means the user owns the page now, so leave it
      // alone and let normal source translation rules apply.
      const entry = manifest?.pages?.[sourcePath]
      if (!entry?.autoIndex) continue
      const current = sourceTexts.get(sourcePath)
      if (typeof current !== 'string') continue
      const source = sourceByPath.get(sourcePath)
      if (stableContentHash(current) !== entry.sourceHash) {
        if (source) source.autoIndexUserEdited = true
        continue
      }
      if (current.replace(/\r\n?/g, '\n') === content) continue
      if (!source) continue
      sourceTexts.set(sourcePath, content)
      source.autoIndexRefresh = true
      source.autoIndexPreviousContent = current
      continue
    }

    const sourceFsPath = path.join(
      rootDir,
      'docs',
      chineseDirName,
      ...relativeSource.split('/')
    )
    generated.push({
      source: {
        kind: 'docs',
        autoIndex: true,
        sourcePath,
        sourceFsPath,
        targets: [
          {
            locale: englishDirName,
            targetPath: `docs/${englishDirName}/${relativeSource}`,
            targetFsPath: path.join(
              rootDir,
              'docs',
              englishDirName,
              ...relativeSource.split('/')
            )
          },
          {
            locale: traditionalDirName,
            targetPath: `docs/${traditionalDirName}/${relativeSource}`,
            targetFsPath: path.join(
              rootDir,
              'docs',
              traditionalDirName,
              ...relativeSource.split('/')
            )
          }
        ]
      },
      content
    })
  }
  return generated
}

function selectedTargetsFor(source, only, selectedLocales) {
  if (only.length === 0) {
    return source.targets.filter((target) => selectedLocales.includes(target.locale))
  }
  const sourceSelected = only.some((value) =>
    normalizeRelativePath(source.sourcePath) === value
  )
  if (sourceSelected) {
    return source.targets.filter((target) => selectedLocales.includes(target.locale))
  }
  return source.targets.filter((target) =>
    selectedLocales.includes(target.locale) &&
    only.some((value) => normalizeRelativePath(target.targetPath) === value)
  )
}

function matchesOnly(source, only) {
  if (only.length === 0) return true
  return only.some((value) =>
    normalizeRelativePath(source.sourcePath) === value ||
    source.targets.some((target) => normalizeRelativePath(target.targetPath) === value)
  )
}

function actionLabel(action) {
  switch (action) {
    case 'create': return '生成'
    case 'update': return '更新'
    case 'regenerate': return '重建'
    case 'unchanged': return '无变化'
    case 'blocked': return '拒绝'
    default: return action
  }
}

function statusLabel(status) {
  switch (status) {
    case 'create': return '新增'
    case 'update': return '更新'
    case 'repair': return '补齐'
    case 'unchanged': return '无变化'
    case 'blocked': return '拒绝'
    default: return status
  }
}

function printPlan(pages, errors, log, errorLog, extra = {}) {
  log('内容同步计划（docs/zh-cn → docs/en、docs/zh-tw）：')
  for (const page of pages) {
    const targetSummary = page.targets
      .map((target) => `${target.locale}=${actionLabel(target.action)}`)
      .join('，')
    log(`  ${statusLabel(page.status)}  ${page.source.sourcePath}（${targetSummary}）`)
    for (const target of page.targets) {
      if (target.action === 'blocked') {
        errorLog(`  拒绝覆盖：${target.targetPath}：${target.reason}`)
      }
    }
  }
  if (extra.baselineInitialized) {
    log(`状态清单将初始化 ${extra.baselineInitialized} 个现存三语页面的可信基线。`)
  }
  if (errors.length > 0) {
    errorLog(`同步错误（${errors.length}）：`)
    for (const error of errors) errorLog(`- ${error}`)
  }
}

function parseCliArgs(argv = []) {
  const options = {
    root: undefined,
    only: [],
    langs: [],
    timeoutMs: undefined,
    dryRun: false,
    init: false,
    help: false
  }
  let separatorSeen = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--' && !separatorSeen) {
      // pnpm/npm may forward the argument separator to the script. Accept
      // exactly one standalone separator and keep rejecting unknown options.
      separatorSeen = true
      continue
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true
    } else if (argument === '--dry-run') {
      options.dryRun = true
    } else if (argument === '--init') {
      options.init = true
    } else if (argument === '--root') {
      const value = argv[index + 1]
      if (!value) throw new Error('--root 需要一个目录')
      options.root = value
      index += 1
    } else if (argument.startsWith('--root=')) {
      const value = argument.slice('--root='.length)
      if (!value) throw new Error('--root 需要一个目录')
      options.root = value
    } else if (argument === '--only') {
      const value = argv[index + 1]
      if (!value) throw new Error('--only 需要一个简体源或目标路径')
      options.only.push(normalizeRelativePath(value))
      index += 1
    } else if (argument.startsWith('--only=')) {
      const value = argument.slice('--only='.length)
      if (!value) throw new Error('--only 需要一个简体源或目标路径')
      options.only.push(normalizeRelativePath(value))
    } else if (argument === '--lang') {
      const value = argv[index + 1]
      if (!targetLocales.includes(value)) {
        throw new Error(`--lang 只支持 ${targetLocales.join('、')}`)
      }
      options.langs.push(value)
      index += 1
    } else if (argument.startsWith('--lang=')) {
      const value = argument.slice('--lang='.length)
      if (!targetLocales.includes(value)) {
        throw new Error(`--lang 只支持 ${targetLocales.join('、')}`)
      }
      options.langs.push(value)
    } else if (argument === '--timeout') {
      const value = argv[index + 1]
      if (!value || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 2_147_483_647) {
        throw new Error('--timeout 需要 1 到 2147483647 之间的整数毫秒数')
      }
      options.timeoutMs = Number(value)
      index += 1
    } else if (argument.startsWith('--timeout=')) {
      const value = argument.slice('--timeout='.length)
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 2_147_483_647) {
        throw new Error('--timeout 需要 1 到 2147483647 之间的整数毫秒数')
      }
      options.timeoutMs = Number(value)
    } else {
      throw new Error(`未知选项：${argument}`)
    }
  }
  options.langs = [...new Set(options.langs)]
  return options
}

function helpText() {
  return `用法：
  pnpm content:sync                    同步 docs/zh-cn 到 docs/en 与 docs/zh-tw 并写入
  pnpm content:sync -- --dry-run       只显示计划，不调用模型、不写文件
  pnpm content:sync -- --init          只为现存完整三语页面初始化可信基线
  pnpm content:sync -- --root <目录>   在隔离副本中运行（用于测试）

行为：
  - 新增简体源自动生成英文和繁中两版；简体源修改后，只更新状态清单中
    哈希仍匹配（未被人工修改）的目标。
  - 目标已存在但状态清单没有可信基线，或目标哈希与清单不一致时拒绝覆盖，
    明确报告并以退出码 1 结束；不会伪造成功。
  - 无变化时不调用模型、不写文件。
  - 英文与繁中均由配置的模型翻译；繁中额外用本机 OpenCC 做脚本校正。
  - 缺少 index.md 且含 Markdown 的 docs/zh-cn 子目录会自动生成最小简体
    索引并翻译两版；Notes 子树使用 <NotesIndex /> 动态列表，其它目录使用
    静态链接列表。本工具生成的索引会在目录条目变化时刷新；一旦用户手改，
    该 index 转为普通源，不再被自动覆盖。
  - 结构检查通过后才进行模型语义检查；所有目标通过后整批原子写入，
    状态清单与内容同批提交。进程在最后提交窗口崩溃时，下一次运行会报告
    哈希冲突，而不是静默覆盖。

选项：
  --root <目录>        在隔离根目录运行；状态清单位于 <目录>/tools/content-sync-state.json
  --only <路径>        只处理指定简体源或目标路径，可重复；指定目标路径时只处理该目标
  --lang <语言>        只处理 en 或 zh-tw，可重复；未生成的语言不会被标记为已同步
  --timeout <毫秒>     单次模型请求超时，默认 ${DEFAULT_TIMEOUT_MS}
  --dry-run            只计划，不调用模型、不写状态清单
  --init               仅初始化状态清单基线；清单已存在时拒绝
  --help               显示本帮助

状态清单：${stateRelativePath}（可提交的 JSON，只含路径与 sha256 哈希）。
模型配置仍来自 tools/config.yaml；本工具不会把配置内容写入状态清单。
`
}

function modelWithTimeout(requestModel, timeoutMs) {
  if (timeoutMs === undefined) return requestModel
  return (request) => requestModel({
    ...request,
    timeoutMs
  })
}

async function recheckBatchSources({ rootDir, fs, pages }) {
  const errors = []
  for (const page of pages) {
    if (page.generatedTargets.length === 0) continue
    if (page.source.autoIndex || page.source.autoIndexRefresh) continue
    try {
      const current = await readSafeMarkdownSource(page.source.sourceFsPath, { rootDir, fs })
      if (stableContentHash(current) !== page.sourceHash) {
        errors.push(`${page.source.sourcePath} 在生成期间被修改或替换`)
      }
    } catch (error) {
      errors.push(`${page.source.sourcePath} 在生成期间被删除或无法安全读取：${truncateError(error)}`)
    }
  }
  return errors
}

async function writeSingleManifest({ rootDir, fs, manifestState, manifest, log, errorLog, dryRun }) {
  const content = serializeManifest(manifest)
  if (manifestState.exists && matchesManifestContent(manifestState.content, content)) {
    log('状态清单已是最新，无需写入。')
    return 0
  }
  if (dryRun) {
    log(`将写入状态清单：${stateRelativePath}（${Object.keys(manifest.pages).length} 个页面基线）。`)
    return 0
  }
  try {
    await writeTranslationsAtomically({
      rootDir,
      fs,
      writes: [{
        targetPath: stateRelativePath,
        targetFsPath: manifestState.fsPath,
        content,
        original: manifestState.original
      }]
    })
  } catch (error) {
    errorLog(`写入状态清单失败：${truncateError(error)}`)
    return 1
  }
  log(`已写入状态清单：${stateRelativePath}（${Object.keys(manifest.pages).length} 个页面基线）。`)
  return 0
}

async function runSync({ rootDir, parsed, requestModel, fs, log, errorLog }) {
  const manifestState = await readStateManifest(rootDir, fs)
  if (parsed.init && manifestState.exists) {
    errorLog(`状态清单 ${stateRelativePath} 已存在；--init 拒绝覆盖。`)
    return 1
  }

  const collection = await collectDocsSources(rootDir)
  if (collection.errors.length > 0) {
    printPlan([], collection.errors, log, errorLog)
    errorLog('存在路径错误，已中止；未写入任何文件。')
    return 1
  }
  const sources = collection.sources
  const errors = []
  const sourceTexts = new Map()

  for (const source of sources) {
    try {
      sourceTexts.set(
        source.sourcePath,
        await readSafeMarkdownSource(source.sourceFsPath, { rootDir, fs })
      )
    } catch (error) {
      errors.push(`${source.sourcePath}：${truncateError(error)}`)
    }
  }
  if (errors.length > 0) {
    printPlan([], errors, log, errorLog)
    errorLog('读取简体源失败，已中止；未写入任何文件。')
    return 1
  }

  if (parsed.init) {
    const manifest = { version: stateVersion, pages: {} }
    const targetStates = new Map()
    const baselineErrors = []
    const baselineCount = await buildBaseline({
      sources,
      sourceTexts,
      manifest,
      rootDir,
      fs,
      targetStates,
      errors: baselineErrors
    })
    if (baselineErrors.length > 0) {
      printPlan([], baselineErrors, log, errorLog)
      errorLog('初始化状态清单失败，已中止；未写入任何文件。')
      return 1
    }
    log(`初始化状态清单：${baselineCount} 个现存三语页面的可信基线。`)
    return writeSingleManifest({
      rootDir,
      fs,
      manifestState,
      manifest,
      log,
      errorLog,
      dryRun: parsed.dryRun
    })
  }

  const generatedIndexes = await discoverAutoIndexes({
    rootDir,
    sources,
    sourceTexts,
    manifest: manifestState.manifest
  })
  for (const generated of generatedIndexes) {
    sources.push(generated.source)
    sourceTexts.set(generated.source.sourcePath, generated.content)
  }
  sources.sort((left, right) => compareText(left.sourcePath, right.sourcePath))

  const selectedLocales = parsed.langs.length > 0 ? parsed.langs : targetLocales
  const only = parsed.only
  const selectedSources = sources.filter((source) =>
    only.length === 0 || matchesOnly(source, only)
  )
  if (only.length > 0 && selectedSources.length === 0) {
    errorLog(`--only 未匹配任何简体源或目标：${only.join(', ')}`)
    return 2
  }

  let manifest = manifestState.manifest
  let baselineInitialized = 0
  const targetStates = new Map()
  const stateErrors = []

  if (!manifest) {
    manifest = { version: stateVersion, pages: {} }
    baselineInitialized = await buildBaseline({
      sources: sources.filter((source) => !source.autoIndex),
      sourceTexts,
      manifest,
      rootDir,
      fs,
      targetStates,
      errors: stateErrors
    })
  }
  if (stateErrors.length > 0) {
    printPlan([], stateErrors, log, errorLog)
    errorLog('初始化状态清单基线失败，已中止；未写入任何文件。')
    return 1
  }

  const pages = []
  for (const source of selectedSources) {
    const sourceText = sourceTexts.get(source.sourcePath)
    if (typeof sourceText !== 'string') {
      stateErrors.push(`${source.sourcePath}：缺少已读取的简体源内容`)
      continue
    }
    const pageTargets = selectedTargetsFor(source, only, selectedLocales)
    if (pageTargets.length === 0) continue
    let targetStateFailed = false
    for (const target of pageTargets) {
      const state = await getTargetState({
        source,
        target,
        rootDir,
        fs,
        cache: targetStates,
        errors: stateErrors
      })
      if (!state) {
        targetStateFailed = true
        break
      }
    }
    if (targetStateFailed) continue
    const manifestEntry = manifest.pages[source.sourcePath] ?? null
    pages.push(planPage({
      source,
      sourceText,
      manifestEntry,
      targetStates,
      targets: pageTargets
    }))
  }

  if (stateErrors.length > 0) {
    printPlan(pages, stateErrors, log, errorLog, { baselineInitialized })
    errorLog('检查目标或状态清单失败，已中止；未写入任何文件。')
    return 1
  }

  if (pages.length === 0 && only.length > 0) {
    errorLog(`--only 与 --lang 未匹配任何可处理目标：${only.join(', ')}`)
    return 2
  }

  const blocked = pages.filter((page) => page.status === 'blocked')
  if (blocked.length > 0) {
    printPlan(pages, [], log, errorLog, { baselineInitialized })
    errorLog(`发现 ${blocked.length} 个需要人工处理的目标冲突，已中止；未调用模型，未写入任何文件。`)
    return 1
  }

  if (parsed.dryRun) {
    printPlan(pages, [], log, errorLog, { baselineInitialized })
    const pending = pages.filter((page) => page.status !== 'unchanged')
    log(
      pending.length === 0
        ? '所有页面已是最新；未调用模型，未写入文件。'
        : `计划处理 ${pending.length} 个页面、${pending.reduce((total, page) => total + page.generatedTargets.length, 0)} 个目标；未调用模型，未写入文件。`
    )
    return 0
  }

  const pagesToGenerate = pages.filter((page) => page.status !== 'unchanged')
  const writes = []
  const timeoutMs = parsed.timeoutMs
  const scopedRequestModel = modelWithTimeout(requestModel, timeoutMs)
  let md
  if (pagesToGenerate.length > 0) {
    try {
      md = await getMarkdownParser(path.join(rootDir, 'docs'))
    } catch (error) {
      printPlan(pages, [], log, errorLog, { baselineInitialized })
      errorLog(`无法初始化 Markdown 解析器：${truncateError(error)}`)
      errorLog('已中止；未调用模型，未写入任何文件。')
      return 1
    }
  }

  for (const page of pagesToGenerate) {
    const generated = []
    for (const target of page.generatedTargets) {
      log(`正在生成（${target.locale}）：${target.targetPath}  ←  ${page.source.sourcePath}`)
      try {
        const content = await translateSource({
          sourcePath: page.source.sourcePath,
          targetPath: target.targetPath,
          sourceText: page.sourceText,
          targetLocale: target.locale,
          requestModel: scopedRequestModel,
          md
        })
        generated.push({
          target,
          content,
          hash: stableContentHash(content)
        })
      } catch (error) {
        printPlan(pages, [], log, errorLog, { baselineInitialized })
        errorLog(`生成失败：${target.targetPath}：${truncateError(error)}`)
        errorLog('已中止；此前生成的结果全部丢弃，未写入任何文件。')
        return 1
      }
    }

    if (page.source.autoIndex || page.source.autoIndexRefresh) {
      const sourcePath = page.source.sourcePath
      const sourceFsPath = page.source.sourceFsPath
      try {
        const current = await readTargetSnapshot(rootDir, sourceFsPath, fs)
        if (page.source.autoIndex) {
          if (current.exists) {
            errorLog(`自动索引源 ${sourcePath} 在生成期间已出现；拒绝覆盖，已中止，未写入任何文件。`)
            return 1
          }
        } else {
          if (!current.exists) {
            errorLog(`自动索引源 ${sourcePath} 在生成期间被删除；已中止，未写入任何文件。`)
            return 1
          }
          if (
            typeof page.source.autoIndexPreviousContent !== 'string' ||
            current.content !== page.source.autoIndexPreviousContent
          ) {
            errorLog(`自动索引源 ${sourcePath} 在生成期间被修改；拒绝覆盖，已中止，未写入任何文件。`)
            return 1
          }
        }
        writes.push({
          targetPath: sourcePath,
          targetFsPath: current.targetFsPath,
          content: page.sourceText,
          original: current.original
        })
      } catch (error) {
        errorLog(`自动索引源检查失败：${sourcePath}：${truncateError(error)}`)
        errorLog('已中止；未写入任何文件。')
        return 1
      }
    }

    for (const item of generated) {
      const state = item.target.state
      if (!state?.original) {
        errorLog(`目标 ${item.target.targetPath} 缺少写入前快照；已中止，未写入任何文件。`)
        return 1
      }
      writes.push({
        targetPath: item.target.targetPath,
        targetFsPath: state.targetFsPath,
        content: item.content,
        original: state.original
      })
    }

    const keepAutoIndex = page.source.autoIndex ||
      (page.manifestEntry?.autoIndex && !page.source.autoIndexUserEdited)
    const entry = {
      sourceHash: page.sourceHash,
      ...(keepAutoIndex ? { autoIndex: true } : {}),
      targets: { ...(page.manifestEntry?.targets ?? {}) }
    }
    for (const item of generated) {
      entry.targets[item.target.locale] = {
        path: item.target.targetPath,
        hash: item.hash,
        sourceHash: page.sourceHash
      }
    }
    manifest.pages[page.source.sourcePath] = entry
  }

  const sourceRecheckErrors = await recheckBatchSources({
    rootDir,
    fs,
    pages: pagesToGenerate
  })
  if (sourceRecheckErrors.length > 0) {
    printPlan(pages, sourceRecheckErrors, log, errorLog, { baselineInitialized })
    errorLog('简体源在生成期间发生变化；已中止，未写入任何文件。')
    return 1
  }

  const manifestContent = serializeManifest(manifest)
  if (!manifestState.exists || !matchesManifestContent(manifestState.content, manifestContent)) {
    writes.push({
      targetPath: stateRelativePath,
      targetFsPath: manifestState.fsPath,
      content: manifestContent,
      original: manifestState.original
    })
  }

  if (writes.length === 0) {
    printPlan(pages, [], log, errorLog, { baselineInitialized })
    log('所有页面已是最新；未调用模型，未写入文件。')
    return 0
  }

  try {
    await writeTranslationsAtomically({
      rootDir,
      writes,
      fs,
      preCommit: async () => {
        const guardErrors = await recheckBatchSources({
          rootDir,
          fs,
          pages: pagesToGenerate
        })
        if (guardErrors.length > 0) {
          throw new Error(
            '简体源在本批提交前发生变化，拒绝写入：\n' +
            guardErrors.join('\n')
          )
        }
      }
    })
  } catch (error) {
    errorLog(`批量写入失败：${truncateError(error)}`)
    return 1
  }

  for (const write of writes) log(`已写入：${write.targetPath}`)
  if (baselineInitialized > 0) {
    log(`已初始化 ${baselineInitialized} 个现存三语页面的可信基线。`)
  }
  const manifestWritten = writes.some((write) => write.targetPath === stateRelativePath)
  if (pagesToGenerate.length === 0) {
    log(
      `状态清单初始化完成：${baselineInitialized} 个现存三语页面的可信基线；` +
      '未调用模型。'
    )
  } else {
    log(
      `完成：${pagesToGenerate.length} 个页面通过结构、安全与目标语言语义检查；` +
      `写入 ${writes.length} 个文件${manifestWritten ? '（含状态清单）' : ''}。`
    )
  }
  return 0
}

export async function main(argv = [], options = {}) {
  const requestModel = options.requestModel
  const fs = options.fs ?? {}
  const log = options.log ?? console.log
  const errorLog = options.errorLog ?? console.error

  let parsed
  try {
    parsed = parseCliArgs(argv)
  } catch (error) {
    errorLog(`参数错误：${error.message}`)
    errorLog(helpText())
    return 2
  }
  if (parsed.help) {
    log(helpText())
    return 0
  }

  let rootDir
  try {
    rootDir = await resolveRealRoot(path.resolve(options.rootDir ?? parsed.root ?? defaultRootDir))
  } catch (error) {
    errorLog(`无法使用仓库根目录：${truncateError(error)}`)
    errorLog('已中止；未写入任何文件。')
    return 1
  }

  try {
    await assertSafeDirectory(rootDir, path.join(rootDir, 'docs'))
    await assertSafeDirectory(rootDir, path.join(rootDir, 'docs', chineseDirName))
  } catch (error) {
    errorLog(`文档目录不安全：${truncateError(error)}`)
    errorLog('已中止；未写入任何文件。')
    return 1
  }

  try {
    return await runSync({
      rootDir,
      parsed,
      requestModel: requestModel ?? (await import('./ai-model.mjs')).requestModel,
      fs,
      log,
      errorLog
    })
  } catch (error) {
    errorLog(`内容同步失败：${truncateError(error)}`)
    return 1
  }
}

function isMainModule() {
  if (!process.argv[1]) return false
  const invoked = path.resolve(process.argv[1])
  const self = fileURLToPath(import.meta.url)
  return process.platform === 'win32'
    ? invoked.toLowerCase() === self.toLowerCase()
    : invoked === self
}

if (isMainModule()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((error) => {
      console.error(`内容同步失败：${truncateError(error)}`)
      process.exitCode = 1
    })
}
