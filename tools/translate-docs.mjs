import { randomBytes } from 'node:crypto'
import {
  lstat,
  link,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
  writeFile
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  analyzeMarkdown,
  compareStructures,
  getMarkdownParser,
  runSemanticReview
} from './check-bilingual.mjs'
import {
  chineseDirName,
  englishDirName,
  isPathInside,
  normalizeRelativePath,
  readmeChinese,
  readmeEnglish,
  readmeTraditional,
  rootDocumentTargets,
  traditionalDirName
} from './document-mapping.mjs'
import { translateFrontmatter } from './frontmatter-translate.mjs'
import { assertNoPrivateContent, sanitizeMarkdownForModel, splitMarkdownDocument } from './markdown-privacy.mjs'
import { translateBodyFragments } from './translate-body.mjs'
import { assertSafeGeneratedMarkup } from './markdown-security.mjs'
import { localeLinkIssues } from './locale-links.mjs'
import { assertSafeDirectory, assertSafePath, resolveRealRoot } from './path-safety.mjs'
import { convertMarkdownToTraditional } from './traditional-chinese.mjs'
import {
  AI_MODEL_CONFIG_PATH,
  DEFAULT_TIMEOUT_MS,
  requestModel as defaultRequestModel,
  sanitizeModelError
} from './ai-model.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const defaultRootDir = path.resolve(here, '..')
const skippedDirectories = new Set(['.git', '.vitepress', 'node_modules', 'public', 'dist'])

function truncateError(error, maxLength = 2_000) {
  return sanitizeModelError(error?.message ?? error ?? '未知错误', maxLength)
}

async function listMarkdownFiles(dir, relative = '') {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name) && !entry.name.startsWith('.')) {
        files.push(...await listMarkdownFiles(path.join(dir, entry.name), rel))
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(rel)
    }
  }
  return files.sort()
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

export async function collectTranslationSources(rootDir = defaultRootDir) {
  const resolvedRoot = path.resolve(rootDir)
  const docsDir = path.join(resolvedRoot, 'docs')
  const sources = []
  const errors = []

  try {
    const files = await listMarkdownFiles(path.join(docsDir, chineseDirName))
    for (const file of files) {
      sources.push({
        kind: 'docs',
        sourcePath: `docs/${chineseDirName}/${file}`,
        sourceFsPath: path.join(docsDir, chineseDirName, file),
        targets: [
          {
            locale: englishDirName,
            targetPath: `docs/${englishDirName}/${file}`,
            targetFsPath: path.join(docsDir, englishDirName, file)
          },
          {
            locale: traditionalDirName,
            targetPath: `docs/${traditionalDirName}/${file}`,
            targetFsPath: path.join(docsDir, traditionalDirName, file)
          }
        ]
      })
    }
  } catch (error) {
    errors.push(
      error.code === 'ENOENT'
        ? '缺少 docs/zh-cn 中文文档目录'
        : `无法读取 docs/zh-cn：${truncateError(error)}`
    )
  }

  let rootEntries = []
  try {
    rootEntries = await readdir(resolvedRoot, { withFileTypes: true })
  } catch (error) {
    errors.push(`无法读取仓库根目录：${truncateError(error)}`)
  }

  for (const entry of rootEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    if (
      entry.name === readmeEnglish ||
      entry.name === readmeTraditional ||
      entry.name === readmeChinese
    ) {
      if (entry.name !== readmeChinese) continue
      sources.push({
        kind: 'readme',
        sourcePath: readmeChinese,
        sourceFsPath: path.join(resolvedRoot, readmeChinese),
        targets: [
          {
            locale: englishDirName,
            targetPath: readmeEnglish,
            targetFsPath: path.join(resolvedRoot, readmeEnglish)
          },
          {
            locale: traditionalDirName,
            targetPath: readmeTraditional,
            targetFsPath: path.join(resolvedRoot, readmeTraditional)
          }
        ]
      })
      continue
    }

    const targetNames = rootDocumentTargets(entry.name)
    if (!targetNames) continue
    sources.push({
      kind: 'root',
      sourcePath: entry.name,
      sourceFsPath: path.join(resolvedRoot, entry.name),
      targets: [
        {
          locale: englishDirName,
          targetPath: targetNames[englishDirName],
          targetFsPath: path.join(resolvedRoot, targetNames[englishDirName])
        },
        {
          locale: traditionalDirName,
          targetPath: targetNames[traditionalDirName],
          targetFsPath: path.join(resolvedRoot, targetNames[traditionalDirName])
        }
      ]
    })
  }

  const seenTargets = new Map()
  const seenSources = new Map()
  const validSources = []
  for (const source of sources) {
    const sourceKey = normalizeRelativePath(source.sourcePath).toLowerCase()
    if (seenSources.has(sourceKey)) {
      errors.push(`同一中文源出现多次：${source.sourcePath}`)
      continue
    }
    seenSources.set(sourceKey, source.sourcePath)

    let valid = true
    if (!isPathInside(resolvedRoot, source.sourceFsPath)) {
      errors.push(`中文源越出仓库目录：${source.sourcePath}`)
      valid = false
    }
    for (const target of source.targets) {
      const targetKey = normalizeRelativePath(target.targetPath).toLowerCase()
      if (!isPathInside(resolvedRoot, target.targetFsPath)) {
        errors.push(`目标越出仓库目录：${source.sourcePath} → ${target.targetPath}`)
        valid = false
        continue
      }
      if (seenTargets.has(targetKey)) {
        errors.push(
          `多个中文源映射到同一目标：${source.sourcePath} 与 ` +
          `${seenTargets.get(targetKey)} → ${target.targetPath}`
        )
        valid = false
        continue
      }
      seenTargets.set(targetKey, source.sourcePath)
    }
    if (valid) validSources.push(source)
  }

  validSources.sort((left, right) =>
    left.sourcePath < right.sourcePath ? -1 : left.sourcePath > right.sourcePath ? 1 : 0
  )
  if (validSources.length === 0 && errors.length === 0) {
    errors.push('没有找到任何中文 Markdown 源文件')
  }

  return { rootDir: resolvedRoot, sources: validSources, errors }
}

async function planTranslations(collection) {
  const items = []
  const errors = [...collection.errors]
  for (const source of collection.sources) {
    const targets = []
    for (const target of source.targets) {
      const kind = await pathKind(target.targetFsPath)
      if (kind.kind === 'symlink') {
        errors.push(`${target.targetPath} 是符号链接；拒绝覆盖仓库外文件`)
      } else if (kind.kind === 'other') {
        errors.push(`${target.targetPath} 不是普通文件；拒绝覆盖`)
      }
      targets.push({
        ...target,
        status: kind.kind === 'file'
          ? 'exists'
          : ['missing', 'symlink', 'other'].includes(kind.kind)
            ? kind.kind
            : 'other'
      })
    }
    items.push({ ...source, targets })
  }
  return { items, errors }
}

export async function translateSource({
  sourcePath,
  targetPath,
  sourceText,
  requestModel,
  md,
  targetLocale = englishDirName
}) {
  if (typeof sourceText !== 'string') throw new TypeError('源文件内容必须是字符串')
  if (typeof requestModel !== 'function') throw new TypeError('翻译需要 requestModel')
  if (!md) throw new TypeError('翻译需要 Markdown 解析器')
  if (targetLocale !== englishDirName) {
    throw new Error('模型翻译当前只生成英文目标；繁体目标使用本机 OpenCC 转换')
  }

  let sanitized
  try {
    sanitized = sanitizeMarkdownForModel(sourceText)
  } catch (error) {
    throw new Error(`无法安全移除私有内容：${truncateError(error)}`)
  }
  const sourceLinkErrors = localeLinkIssues(sanitized, chineseDirName, sourcePath)
  if (sourceLinkErrors.length > 0) {
    throw new Error(`中文源站内链接不符合语言前缀约定：\n${sourceLinkErrors.join('\n')}`)
  }

  const document = splitMarkdownDocument(sanitized)
  let frontmatter = null
  if (document.frontmatter !== null) {
    frontmatter = await translateFrontmatter(document.frontmatter, {
      requestModel,
      sourcePath,
      targetLocale
    })
  }

  let body = await translateBodyFragments(document.body, { requestModel, sourcePath, md })
  body = body.trim()
  if (body) {
    body = `${body}\n`
    if (document.frontmatter !== null && document.body.startsWith('\n')) {
      body = `\n${body}`
    }
  }

  const english = document.frontmatter === null
    ? body
    : `${document.opening}${frontmatter}${document.closing}${body}`
  if (!english.trim()) throw new Error('生成的英文页面为空')

  assertNoPrivateContent(english, '生成的英文页面')
  await assertSafeGeneratedMarkup(sanitized, english, '生成的英文页面', { md })

  const structureErrors = compareStructures(
    targetPath,
    sourcePath,
    analyzeMarkdown(english, md),
    analyzeMarkdown(sanitized, md),
    { leftLabel: 'English', rightLabel: 'Simplified Chinese' }
  )
  if (structureErrors.length > 0) {
    throw new Error(`Markdown 结构校验失败：\n${structureErrors.join('\n')}`)
  }

  const verdict = await runSemanticReview({
    file: `${targetPath} vs ${sourcePath}`,
    source: sanitized,
    target: english,
    sourceLabel: 'Simplified Chinese',
    targetLabel: 'English',
    requestModel,
    md
  })
  if (!verdict.equivalent) {
    throw new Error(`三语语义校验失败：\n${verdict.issues.map((issue) => `- ${issue}`).join('\n')}`)
  }

  return english
}

export async function translateTraditionalSource({
  sourcePath,
  targetPath,
  sourceText,
  md
}) {
  const sanitized = sanitizeMarkdownForModel(sourceText)
  const sourceLinkErrors = localeLinkIssues(sanitized, chineseDirName, sourcePath)
  if (sourceLinkErrors.length > 0) {
    throw new Error(`中文源站内链接不符合语言前缀约定：\n${sourceLinkErrors.join('\n')}`)
  }
  const traditional = await convertMarkdownToTraditional(sourceText, { md, sourcePath, targetPath })
  const structureErrors = compareStructures(
    targetPath,
    sourcePath,
    analyzeMarkdown(traditional, md),
    analyzeMarkdown(sanitized, md),
    { leftLabel: 'Traditional Chinese', rightLabel: 'Simplified Chinese' }
  )
  if (structureErrors.length > 0) {
    throw new Error(`Markdown 结构校验失败：\n${structureErrors.join('\n')}`)
  }
  return traditional
}

async function snapshotTarget(targetFsPath) {
  const info = await pathKind(targetFsPath)
  if (info.kind === 'symlink') throw new Error('目标路径是符号链接，拒绝覆盖')
  if (info.kind === 'other') throw new Error('目标路径不是普通文件，拒绝覆盖')
  if (info.kind === 'missing') return { exists: false, content: null, mode: 0o666 }
  return {
    exists: true,
    content: await readFile(targetFsPath, 'utf8'),
    mode: info.info.mode & 0o777
  }
}

export async function writeTranslationsAtomically({ rootDir, writes, fs = {} }) {
  const operations = {
    lstat: fs.lstat ?? lstat,
    realpath: fs.realpath ?? realpath,
    link: fs.link ?? link,
    readFile: fs.readFile ?? readFile,
    writeFile: fs.writeFile ?? writeFile,
    rename: fs.rename ?? rename,
    unlink: fs.unlink ?? unlink,
    mkdir: fs.mkdir ?? mkdir
  }
  const resolvedRoot = await resolveRealRoot(rootDir, operations)
  const temps = []
  const committed = []
  const rollbackErrors = []
  const backups = []
  const conflicts = []

  const writeSibling = async (write, content, prefix) => {
    const parent = path.dirname(write.targetFsPath)
    await assertSafeDirectory(resolvedRoot, parent, operations)
    const sibling = path.join(parent, `.omp-translate-${prefix}-${randomBytes(6).toString('hex')}.tmp`)
    await operations.writeFile(sibling, content, {
      encoding: 'utf8',
      flag: 'wx',
      mode: write.original.mode
    })
    return assertSafePath(resolvedRoot, sibling, {
      allowMissing: false,
      requireFile: true,
      label: `${prefix} 文件`,
      fs: operations
    })
  }

  const preserveGeneratedConflict = async (write) => {
    try {
      const conflict = await writeSibling(write, write.content, 'conflict')
      conflicts.push(conflict)
      return conflict
    } catch (error) {
      rollbackErrors.push(`${write.targetPath}：无法保存冲突副本：${truncateError(error)}`)
      return null
    }
  }

  const verifyTarget = async (write) => {
    const safeTarget = await assertSafePath(resolvedRoot, write.targetFsPath, {
      allowMissing: true,
      requireFile: false,
      label: '目标',
      fs: operations
    })
    write.targetFsPath = safeTarget
    const current = await pathKindWith(operations, safeTarget)
    if (current.kind === 'symlink') {
      throw new Error(`${write.targetPath} 的路径包含符号链接或 junction，已中止`)
    }
    if (current.kind === 'other') {
      throw new Error(`${write.targetPath} 不是普通文件，已中止`)
    }
    if (write.original.exists) {
      if (current.kind === 'missing') {
        throw new Error(`${write.targetPath} 在生成期间被删除，已中止`)
      }
      await assertSafePath(resolvedRoot, safeTarget, {
        allowMissing: false,
        requireFile: true,
        label: '目标',
        fs: operations
      })
      const content = await operations.readFile(safeTarget, 'utf8')
      if (content !== write.original.content) {
        throw new Error(`${write.targetPath} 在生成期间被修改，已中止以避免覆盖人工内容`)
      }
    } else if (current.kind !== 'missing') {
      throw new Error(`${write.targetPath} 在生成期间被创建，已中止以避免覆盖已有内容`)
    }
    return safeTarget
  }

  for (const write of writes) {
    write.targetFsPath = await assertSafePath(resolvedRoot, write.targetFsPath, {
      allowMissing: true,
      requireFile: false,
      label: '目标',
      fs: operations
    })
  }

  try {
    for (const write of writes) {
      await verifyTarget(write)
      const parent = path.dirname(write.targetFsPath)
      await assertSafePath(resolvedRoot, parent, {
        allowMissing: true,
        requireFile: false,
        label: '输出目录',
        fs: operations
      })
      await operations.mkdir(parent, { recursive: true })
      await assertSafeDirectory(resolvedRoot, parent, operations)

      const temp = path.join(parent, `.omp-translate-${randomBytes(6).toString('hex')}.tmp`)
      await operations.writeFile(temp, write.content, {
        encoding: 'utf8',
        flag: 'wx',
        mode: write.original.mode
      })
      const safeTemp = await assertSafePath(resolvedRoot, temp, {
        allowMissing: false,
        requireFile: true,
        label: '临时文件',
        fs: operations
      })
      temps.push(safeTemp)
      write.temp = safeTemp
    }

    for (const write of writes) {
      // Re-check immediately before each commit. New targets use an exclusive
      // hard link, so a concurrent creator cannot be overwritten. Existing
      // targets still have a final-check-to-rename window; it is intentionally
      // reported as a limitation rather than hidden.
      const safeTarget = await verifyTarget(write)
      await assertSafePath(resolvedRoot, write.temp, {
        allowMissing: false,
        requireFile: true,
        label: '临时文件',
        fs: operations
      })

      if (write.original.exists) {
        write.backup = await writeSibling(write, write.original.content, 'backup')
        backups.push(write.backup)
        // Backup creation takes time; re-check the target before replacing it.
        const finalTarget = await verifyTarget(write)
        await operations.rename(write.temp, finalTarget)
        committed.push(write)
        const after = await pathKindWith(operations, finalTarget)
        if (after.kind !== 'file' || await operations.readFile(finalTarget, 'utf8') !== write.content) {
          throw new Error(`${write.targetPath} 提交后内容不是生成结果，已中止`)
        }
      } else {
        try {
          await operations.link(write.temp, safeTarget)
        } catch (error) {
          if (error.code === 'EEXIST') {
            throw new Error(`${write.targetPath} 在提交瞬间被创建，已中止以避免覆盖`)
          }
          throw error
        }
        committed.push(write)
        await operations.unlink(write.temp).catch(() => {})
      }
    }

    for (const temp of temps) {
      await operations.unlink(temp).catch(() => {})
    }
    for (const backup of backups) {
      await operations.unlink(backup).catch(() => {})
    }
  } catch (error) {
    for (const write of [...committed].reverse()) {
      try {
        const safeTarget = await assertSafePath(resolvedRoot, write.targetFsPath, {
          allowMissing: true,
          requireFile: false,
          label: '目标',
          fs: operations
        })
        const current = await pathKindWith(operations, safeTarget)
        if (current.kind === 'symlink' || current.kind === 'other') {
          const conflict = await preserveGeneratedConflict(write)
          rollbackErrors.push(
            `${write.targetPath}：目标变成符号链接或非普通文件，未回滚` +
            (conflict ? `；已保留生成冲突副本 ${conflict}` : '')
          )
          continue
        }

        if (write.original.exists) {
          if (current.kind === 'missing') {
            const conflict = await preserveGeneratedConflict(write)
            rollbackErrors.push(
              `${write.targetPath}：目标已被删除，未回滚` +
              (conflict ? `；已保留生成冲突副本 ${conflict}` : '')
            )
            continue
          }
          const currentContent = await operations.readFile(safeTarget, 'utf8')
          if (currentContent !== write.content) {
            const conflict = await preserveGeneratedConflict(write)
            rollbackErrors.push(
              `${write.targetPath}：目标已被并发修改，拒绝回滚覆盖` +
              (conflict ? `；已保留生成冲突副本 ${conflict}` : '')
            )
            continue
          }
          let backupProblem = null
          if (!write.backup) {
            backupProblem = `${write.targetPath}：缺少原始备份`
          } else {
            const safeBackup = await assertSafePath(resolvedRoot, write.backup, {
              allowMissing: false,
              requireFile: true,
              label: '原始备份',
              fs: operations
            })
            write.backup = safeBackup
            const backupContent = await operations.readFile(safeBackup, 'utf8')
            if (backupContent !== write.original.content) {
              backupProblem = `${write.targetPath}：原始备份内容不一致`
            }
          }
          if (backupProblem) rollbackErrors.push(backupProblem)

          const parent = path.dirname(safeTarget)
          const restore = path.join(parent, `.omp-translate-restore-${randomBytes(6).toString('hex')}.tmp`)
          await operations.writeFile(restore, write.original.content, {
            encoding: 'utf8',
            flag: 'wx',
            mode: write.original.mode
          })
          await assertSafePath(resolvedRoot, restore, {
            allowMissing: false,
            requireFile: true,
            label: '回滚临时文件',
            fs: operations
          })
          const recheck = await operations.readFile(safeTarget, 'utf8')
          if (recheck !== write.content) {
            await operations.unlink(restore).catch(() => {})
            const conflict = await preserveGeneratedConflict(write)
            rollbackErrors.push(
              `${write.targetPath}：目标在回滚前被并发修改，拒绝覆盖` +
              (conflict ? `；已保留生成冲突副本 ${conflict}` : '')
            )
            continue
          }
          await operations.rename(restore, safeTarget)
          if (write.backup) write.backupConsumed = false
        } else {
          if (current.kind === 'missing') continue
          const currentContent = await operations.readFile(safeTarget, 'utf8')
          if (currentContent !== write.content) {
            const conflict = await preserveGeneratedConflict(write)
            rollbackErrors.push(
              `${write.targetPath}：目标已被并发修改，拒绝删除` +
              (conflict ? `；已保留生成冲突副本 ${conflict}` : '')
            )
            continue
          }
          const recheck = await operations.readFile(safeTarget, 'utf8')
          if (recheck !== write.content) {
            const conflict = await preserveGeneratedConflict(write)
            rollbackErrors.push(
              `${write.targetPath}：目标在回滚前被并发修改，拒绝删除` +
              (conflict ? `；已保留生成冲突副本 ${conflict}` : '')
            )
            continue
          }
          await operations.unlink(safeTarget)
        }
      } catch (rollbackError) {
        rollbackErrors.push(`${write.targetPath}：${truncateError(rollbackError)}`)
      }
    }

    for (const temp of temps) {
      await operations.unlink(temp).catch(() => {})
    }

    for (const backup of backups) {
      const owner = writes.find((write) => write.backup === backup)
      if (!owner || owner.backupConsumed) continue
      try {
        const safeTarget = await assertSafePath(resolvedRoot, owner.targetFsPath, {
          allowMissing: true,
          requireFile: false,
          label: '目标',
          fs: operations
        })
        const current = await pathKindWith(operations, safeTarget)
        if (current.kind === 'file' && await operations.readFile(safeTarget, 'utf8') === owner.original.content) {
          await operations.unlink(backup).catch(() => {})
          continue
        }
        rollbackErrors.push(`${owner.targetPath}：已保留原始备份 ${backup}`)
      } catch (backupError) {
        rollbackErrors.push(`${owner.targetPath}：已保留原始备份 ${backup}（无法复核：${truncateError(backupError)}）`)
      }
    }

    if (rollbackErrors.length > 0) {
      const conflictNote = conflicts.length > 0
        ? `\n保留的生成冲突副本：\n${conflicts.join('\n')}`
        : ''
      throw new Error(
        `批量写入失败，且回滚未完全成功：${truncateError(error)}\n` +
        `并发/回滚问题：\n${rollbackErrors.join('\n')}${conflictNote}`
      )
    }
    throw new Error(`批量写入失败，已回滚：${truncateError(error)}`)
  }
}

async function pathKindWith(operations, targetPath) {
  try {
    const info = await operations.lstat(targetPath)
    if (info.isSymbolicLink()) return { kind: 'symlink', info }
    if (info.isFile()) return { kind: 'file', info }
    return { kind: 'other', info }
  } catch (error) {
    if (error.code === 'ENOENT') return { kind: 'missing', info: null }
    throw error
  }
}

const targetLocales = [englishDirName, traditionalDirName]

function parseTargetLocale(value) {
  if (!targetLocales.includes(value)) {
    throw new Error(`--lang 只支持 ${targetLocales.join('、')}`)
  }
  return value
}

function parseCliArgs(argv = []) {
  const options = {
    write: false,
    force: false,
    only: [],
    langs: [],
    timeoutMs: undefined,
    root: undefined,
    help: false
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') {
      options.help = true
    } else if (argument === '--write') {
      options.write = true
    } else if (argument === '--force') {
      options.force = true
    } else if (argument === '--only') {
      const value = argv[index + 1]
      if (!value) throw new Error('--only 需要一个中文源或目标路径')
      options.only.push(normalizeRelativePath(value))
      index += 1
    } else if (argument.startsWith('--only=')) {
      const value = argument.slice('--only='.length)
      if (!value) throw new Error('--only 需要一个中文源或目标路径')
      options.only.push(normalizeRelativePath(value))
    } else if (argument === '--lang') {
      const value = argv[index + 1]
      if (!value) throw new Error('--lang 需要一个目标语言')
      options.langs.push(parseTargetLocale(value))
      index += 1
    } else if (argument.startsWith('--lang=')) {
      options.langs.push(parseTargetLocale(argument.slice('--lang='.length)))
    } else if (argument === '--root') {
      const value = argv[index + 1]
      if (!value) throw new Error('--root 需要一个目录')
      options.root = value
      index += 1
    } else if (argument.startsWith('--root=')) {
      const value = argument.slice('--root='.length)
      if (!value) throw new Error('--root 需要一个目录')
      options.root = value
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
  if (options.force && !options.write) {
    throw new Error('--force 必须与 --write 一起使用，避免误以为已写入')
  }
  options.langs = [...new Set(options.langs)]
  return options
}

function helpText() {
  return `用法：
  pnpm translate:docs                       查看简中源 → 英文/繁体目标映射（不调用模型）
  pnpm translate:docs -- --write            生成缺失的英文与繁体页面；全批验证通过后才写入
  pnpm translate:docs -- --write --force    重新生成并覆盖已有英文与繁体页面（危险，需明确选择）
  pnpm check:bilingual                      对三语页面、根文档和界面文案做结构、链接及语义检查

选项：
  --write              写入目标页面；默认只显示映射，不写文件
  --force              允许覆盖已存在的目标页面；必须同时使用 --write
  --only <路径>        只处理指定中文源或目标路径，可重复
  --lang <语言>        只处理 en 或 zh-tw，可重复；默认两种都处理
  --root <目录>        在隔离目录中运行（用于临时副本或单对文件的真实模型验证）
  --timeout <毫秒>     单次模型请求超时，默认 ${DEFAULT_TIMEOUT_MS}
  --help               显示本帮助

模型与本地依赖：
  英文通过本机私有配置 ${AI_MODEL_CONFIG_PATH}（YAML；已被 .gitignore 忽略）调用
  OpenAI-compatible chat completions 端点；模型与端点来自该配置，密钥不会输出。
  可用 AI_MODEL_CONFIG、AI_MODEL、AI_REQUEST_TIMEOUT_MS 覆盖；不需要 OMP 程序或登录。
  所有中文源先移除 HTML 注释与显式私有块，再发送给模型。
  繁体由本机 opencc-js（OpenCC cn→twp）确定性转换，不联网、不调用模型。
  代码、公式、URL、HTML 标签和 Mermaid 图结构逐字保留；读者可见的 Mermaid
  标签单独转换。结构、安全标记和受保护内容在写入前再次校验。
`
}

function matchesOnly(item, only) {
  return only.some((value) =>
    normalizeRelativePath(item.sourcePath) === value ||
    item.targets.some((target) => normalizeRelativePath(target.targetPath) === value)
  )
}

function printPlan(items, errors, log, errorLog, langs = []) {
  const wanted = langs.length > 0 ? new Set(langs) : null
  log('简中源 → 英文/繁体目标映射：')
  for (const item of items) {
    for (const target of item.targets) {
      if (wanted && !wanted.has(target.locale)) continue
      const status = target.status === 'missing'
        ? '缺失  '
        : target.status === 'exists'
          ? '已存在'
          : '出错  '
      const note = target.status === 'exists' ? '（默认跳过；--write --force 才覆盖）' : ''
      log(`  ${status} ${target.targetPath}  ←  ${item.sourcePath}${note}`)
    }
  }
  if (errors.length > 0) {
    errorLog(`映射错误（${errors.length}）：`)
    for (const error of errors) errorLog(`- ${error}`)
  }
}

export async function main(argv = [], options = {}) {
  const requestModel = options.requestModel ?? defaultRequestModel
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

  const collection = await collectTranslationSources(rootDir)
  let planned
  try {
    planned = await planTranslations(collection)
  } catch (error) {
    errorLog(`无法检查目标文件：${truncateError(error)}`)
    errorLog('已中止；未写入任何文件。')
    return 1
  }

  const selectedLangs = parsed.langs.length > 0 ? parsed.langs : targetLocales
  const selectedTargets = (item) => {
    const bySource = parsed.only.length === 0 || parsed.only.some((value) =>
      normalizeRelativePath(item.sourcePath) === value
    )
    return item.targets.filter((target) =>
      selectedLangs.includes(target.locale) &&
      (
        bySource ||
        parsed.only.some((value) => normalizeRelativePath(target.targetPath) === value)
      )
    )
  }

  const items = (parsed.only.length > 0
    ? planned.items.filter((item) => matchesOnly(item, parsed.only))
    : planned.items)
    .map((item) => ({ ...item, targets: selectedTargets(item) }))
    .filter((item) => item.targets.length > 0)
  if (parsed.only.length > 0 && items.length === 0) {
    errorLog(`--only 未匹配任何中文源或目标：${parsed.only.join(', ')}`)
    return 2
  }

  const errors = planned.errors
  if (!parsed.write) {
    printPlan(items, errors, log, errorLog, selectedLangs)
    if (errors.length > 0) return 1
    const targets = items.flatMap((item) => item.targets)
    const missing = targets.filter((target) => target.status === 'missing').length
    const existing = targets.filter((target) => target.status === 'exists').length
    log(
      `共 ${targets.length} 个目标：缺失 ${missing}，已存在 ${existing}。` +
      '未写入任何文件。运行 pnpm translate:docs -- --write 生成缺失页面。'
    )
    return 0
  }

  if (errors.length > 0) {
    printPlan(items, errors, log, errorLog, selectedLangs)
    errorLog('存在映射错误，已中止；未写入任何文件。')
    return 1
  }

  const candidates = []
  for (const item of items) {
    for (const target of item.targets) {
      if (target.status === 'missing' || (parsed.force && target.status === 'exists')) {
        candidates.push({ item, target })
      } else if (target.status === 'exists') {
        log(`跳过已有目标（未使用 --force）：${target.targetPath}  ←  ${item.sourcePath}`)
      }
    }
  }
  if (candidates.length === 0) {
    log('没有需要生成的目标页面。')
    return 0
  }

  let md
  try {
    md = await getMarkdownParser(path.join(rootDir, 'docs'))
  } catch (error) {
    errorLog(`无法初始化 Markdown 解析器：${truncateError(error)}`)
    return 1
  }

  const writes = []
  const candidatesByItem = new Map()
  for (const candidate of candidates) {
    if (!candidatesByItem.has(candidate.item)) candidatesByItem.set(candidate.item, [])
    candidatesByItem.get(candidate.item).push(candidate.target)
  }

  for (const [item, itemTargets] of candidatesByItem) {
    let sourceText
    try {
      const safeSource = await assertSafePath(rootDir, item.sourceFsPath, {
        allowMissing: false,
        requireFile: true,
        label: '中文源'
      })
      sourceText = await readFile(safeSource, 'utf8')
      // Re-check after the read so a path component swapped during the I/O is
      // not silently used for model or conversion input.
      await assertSafePath(rootDir, safeSource, {
        allowMissing: false,
        requireFile: true,
        label: '中文源'
      })
    } catch (error) {
      errorLog(`读取失败：${item.sourcePath}：${truncateError(error)}`)
      errorLog('已中止；未写入任何文件。')
      return 1
    }

    for (const target of itemTargets) {
      log(`正在生成（${target.locale}）：${target.targetPath}  ←  ${item.sourcePath}`)
      let original
      let safeTarget
      try {
        safeTarget = await assertSafePath(rootDir, target.targetFsPath, {
          allowMissing: true,
          requireFile: true,
          label: '目标'
        })
        original = await snapshotTarget(safeTarget)
        if (target.status === 'missing' && original.exists) {
          errorLog(
            `${target.targetPath} 在生成前已出现；为避免覆盖人工内容，已中止且未写入任何文件。`
          )
          return 1
        }
      } catch (error) {
        errorLog(`读取失败：${target.targetPath}：${truncateError(error)}`)
        errorLog('已中止；未写入任何文件。')
        return 1
      }

      try {
        const content = target.locale === traditionalDirName
          ? await translateTraditionalSource({
              sourcePath: item.sourcePath,
              targetPath: target.targetPath,
              sourceText,
              md
            })
          : await translateSource({
              sourcePath: item.sourcePath,
              targetPath: target.targetPath,
              sourceText,
              targetLocale: target.locale,
              requestModel: (request) => requestModel({
                ...request,
                timeoutMs: parsed.timeoutMs ?? request.timeoutMs
              }),
              md
            })
        writes.push({
          targetPath: target.targetPath,
          targetFsPath: safeTarget,
          content,
          original
        })
      } catch (error) {
        errorLog(`生成失败：${target.targetPath}：${truncateError(error)}`)
        errorLog('已中止；此前生成的结果全部丢弃，未写入任何文件。')
        return 1
      }
    }
  }

  try {
    await writeTranslationsAtomically({ rootDir, writes, fs })
  } catch (error) {
    errorLog(truncateError(error))
    return 1
  }

  for (const write of writes) log(`已写入：${write.targetPath}`)
  log(
    `完成：写入 ${writes.length} 个目标页面；全部页面均通过结构、安全与目标语言校验。`
  )
  return 0
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
      console.error(`翻译失败：${truncateError(error)}`)
      process.exitCode = 1
    })
}
