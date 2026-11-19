import assert from 'node:assert/strict'
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  SAFE_MARKDOWN_READ_FAILED,
  assertSafeDirectory,
  assertSafePath,
  canonicalInternalHref,
  hasCjk,
  isLocalePrefixedHref,
  isPathInside,
  localizeInternalHref,
  readSafeMarkdownSource,
  resolveRealRoot,
  rootDocumentTargetName,
  rootDocumentTargets
} from './document-model.mjs'

test('only explicitly Simplified Chinese root filenames become translation sources', () => {
  assert.equal(rootDocumentTargetName('README.zh-CN.md'), null)
  assert.equal(rootDocumentTargetName('README.md'), null)
  assert.equal(rootDocumentTargetName('README.zh-TW.md'), null)
  assert.equal(rootDocumentTargetName('notes.en.md'), null)
  assert.equal(rootDocumentTargetName('notes.zh-TW.md'), null)
  assert.equal(rootDocumentTargetName('English-notes.md'), null)
  assert.equal(
    rootDocumentTargetName('网站问题排查与优化方案.md'),
    '网站问题排查与优化方案.en.md'
  )
  assert.equal(
    rootDocumentTargetName('网站问题排查与优化方案.md', 'zh-tw'),
    '网站问题排查与优化方案.zh-TW.md'
  )
  assert.equal(rootDocumentTargetName('说明.zh-CN.md'), '说明.md')
  assert.equal(rootDocumentTargetName('说明.zh-cn.md'), '说明.md')
  assert.equal(rootDocumentTargetName('说明.zh-CN.md', 'zh-tw'), '说明.zh-TW.md')
  assert.equal(rootDocumentTargetName('说明.en.md'), null)
})

test('root document triples reject unsupported locales and generated files', () => {
  assert.deepEqual(rootDocumentTargets('说明.zh-CN.md'), {
    en: '说明.md',
    'zh-tw': '说明.zh-TW.md'
  })
  assert.deepEqual(rootDocumentTargets('资料.md'), {
    en: '资料.en.md',
    'zh-tw': '资料.zh-TW.md'
  })
  assert.equal(rootDocumentTargets('README.zh-CN.md'), null)
  assert.equal(rootDocumentTargets('说明.zh-TW.md'), null)
  assert.equal(rootDocumentTargetName('说明.md', 'fr'), null)
})

test('Chinese proper names inside content do not mark an English filename', () => {
  assert.equal(hasCjk('提到郭彦禛'), true)
  assert.equal(hasCjk('English text'), false)
  assert.equal(rootDocumentTargetName('English.md'), null)
})

test('internal targets are localized to each locale without touching external URLs', () => {
  assert.equal(localizeInternalHref('/zh-cn/Notes/', 'en'), '/en/Notes/')
  assert.equal(localizeInternalHref('/zh-cn/Notes/', 'zh-tw'), '/zh-tw/Notes/')
  assert.equal(localizeInternalHref('/en/Notes/', 'zh-cn'), '/zh-cn/Notes/')
  assert.equal(localizeInternalHref('/zh-tw/Notes/', 'en'), '/en/Notes/')
  assert.equal(localizeInternalHref('/zh-cn', 'en'), '/en/')
  assert.equal(localizeInternalHref('/zh-cn?x=1', 'en'), '/en/?x=1')
  assert.equal(localizeInternalHref('/zh-cn#top', 'zh-tw'), '/zh-tw/#top')
  assert.equal(localizeInternalHref('/', 'en'), '/en/')
  assert.equal(localizeInternalHref('/', 'zh-tw'), '/zh-tw/')
  assert.equal(localizeInternalHref('/images/pic.png', 'zh-tw'), '/images/pic.png')
  assert.equal(localizeInternalHref('/zh-cn/images/pic.png', 'en'), '/images/pic.png')
  assert.equal(localizeInternalHref('/zh-tw/styles/site.css?x=1', 'zh-cn'), '/styles/site.css?x=1')
  assert.equal(localizeInternalHref('https://example.com/zh-cn/', 'en'), 'https://example.com/zh-cn/')
  assert.equal(localizeInternalHref('zh-cn/Notes/', 'en'), 'zh-cn/Notes/')
})

test('canonical routes compare across all three locales', () => {
  assert.equal(canonicalInternalHref('/en/Notes/'), '/Notes/')
  assert.equal(canonicalInternalHref('/zh-cn/Notes/'), '/Notes/')
  assert.equal(canonicalInternalHref('/zh-tw/Notes/'), '/Notes/')
  assert.equal(canonicalInternalHref('/en'), '/')
  assert.equal(canonicalInternalHref('/en?x=1'), '/?x=1')
  assert.equal(canonicalInternalHref('/Notes/'), '/Notes/')
  assert.equal(canonicalInternalHref('https://example.com/en/'), 'https://example.com/en/')
  assert.equal(isLocalePrefixedHref('/en/Notes/', 'en'), true)
  assert.equal(isLocalePrefixedHref('/zh-cn/Notes/', 'en'), false)
  assert.equal(isLocalePrefixedHref('/english/Notes/', 'en'), false)
})

test('path containment rejects traversal and absolute siblings', () => {
  assert.equal(isPathInside('D:/site', 'D:/site/docs/index.md'), true)
  assert.equal(isPathInside('D:/site', 'D:/site'), true)
  assert.equal(isPathInside('D:/site', 'D:/site2/index.md'), false)
  assert.equal(isPathInside('D:/site', 'D:/other/index.md'), false)
})

function info({ symlink = false, directory = false, file = false } = {}) {
  return {
    isSymbolicLink: () => symlink,
    isDirectory: () => directory,
    isFile: () => file
  }
}

function fakeFileSystem(entries, realpaths = {}) {
  return {
    lstat: async (target) => {
      const key = path.resolve(target)
      if (!(key in entries)) {
        const error = new Error('ENOENT')
        error.code = 'ENOENT'
        throw error
      }
      return entries[key]
    },
    realpath: async (target) => {
      const key = path.resolve(target)
      if (key in realpaths) return realpaths[key]
      if (key in entries) return key
      const error = new Error('ENOENT')
      error.code = 'ENOENT'
      throw error
    }
  }
}

test('parent symlinks and junctions are rejected component by component', async () => {
  const root = path.resolve('fake-site-root')
  const link = path.join(root, 'linked')
  const target = path.join(link, 'index.md')
  const fs = fakeFileSystem({
    [root]: info({ directory: true }),
    [link]: info({ symlink: true })
  })
  await assert.rejects(
    assertSafePath(root, target, { fs, allowMissing: false, label: '源文件' }),
    /符号链接或 junction/
  )
})

test('a resolved target outside the real root is rejected', async () => {
  const root = path.resolve('fake-site-root')
  const docs = path.join(root, 'docs')
  const target = path.join(docs, 'index.md')
  const outside = path.resolve('outside-index.md')
  const fs = fakeFileSystem(
    {
      [root]: info({ directory: true }),
      [docs]: info({ directory: true }),
      [target]: info({ file: true })
    },
    { [root]: root, [target]: outside }
  )
  await assert.rejects(
    assertSafePath(root, target, { fs, allowMissing: false, requireFile: true }),
    /真实路径越出仓库目录/
  )
})

test('missing sources fail while missing targets are allowed before creation', async () => {
  const root = path.resolve('fake-site-root')
  const docs = path.join(root, 'docs')
  const target = path.join(docs, 'index.md')
  const fs = fakeFileSystem({
    [root]: info({ directory: true }),
    [docs]: info({ directory: true })
  })
  await assert.rejects(
    assertSafePath(root, target, { fs, allowMissing: false, requireFile: true }),
    /不存在/
  )
  assert.equal(
    await assertSafePath(root, target, { fs, allowMissing: true }),
    target
  )
})

test('a file used as a parent directory is rejected', async () => {
  const root = path.resolve('fake-site-root')
  const parent = path.join(root, 'docs')
  const target = path.join(parent, 'index.md')
  const fs = fakeFileSystem({
    [root]: info({ directory: true }),
    [parent]: info({ file: true })
  })
  await assert.rejects(
    assertSafePath(root, target, { fs, allowMissing: true }),
    /父路径不是目录/
  )
})

test('assertSafeDirectory requires a real directory inside the root', async () => {
  const root = path.resolve('fake-site-root')
  const docs = path.join(root, 'docs')
  const fs = fakeFileSystem({
    [root]: info({ directory: true }),
    [docs]: info({ directory: true })
  })
  assert.equal(await assertSafeDirectory(root, docs, fs), docs)
  await assert.rejects(
    assertSafeDirectory(root, path.join(root, 'missing'), fs),
    /不存在/
  )
})

test('resolveRealRoot resolves the root once and fails closed on missing roots', async () => {
  const root = path.resolve('fake-site-root')
  const real = path.resolve('real-site-root')
  assert.equal(await resolveRealRoot(root, fakeFileSystem({}, { [root]: real })), real)
  await assert.rejects(
    resolveRealRoot(path.resolve('missing-root'), fakeFileSystem({})),
    /无法解析仓库根目录/
  )
})

async function makeSafetyRoot(t) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'safe-markdown-'))
  const previousEnv = process.env.AI_MODEL_CONFIG
  delete process.env.AI_MODEL_CONFIG
  t.after(() => {
    if (previousEnv === undefined) delete process.env.AI_MODEL_CONFIG
    else process.env.AI_MODEL_CONFIG = previousEnv
  })
  t.after(() => rm(rootDir, { recursive: true, force: true }))
  await mkdir(path.join(rootDir, 'tools'), { recursive: true })
  await mkdir(path.join(rootDir, 'docs', 'zh-cn'), { recursive: true })
  return rootDir
}

async function captureReadError(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  assert.fail('Expected the safe Markdown read to fail')
}

test('safe Markdown read returns ordinary files and skips missing protected configs', async (t) => {
  const rootDir = await makeSafetyRoot(t)
  const source = path.join(rootDir, 'docs', 'zh-cn', 'index.md')
  await writeFile(source, '# 标题\n\n正文。\n', 'utf8')
  const previousEnv = process.env.AI_MODEL_CONFIG
  process.env.AI_MODEL_CONFIG = path.join(rootDir, 'missing-config.yaml')
  t.after(() => {
    if (previousEnv === undefined) delete process.env.AI_MODEL_CONFIG
    else process.env.AI_MODEL_CONFIG = previousEnv
  })

  assert.equal(
    await readSafeMarkdownSource(source, { rootDir, protectedIdentities: new Set() }),
    '# 标题\n\n正文。\n'
  )
})

test('safe Markdown read rejects a source hardlinked to the default private config', async (t) => {
  const rootDir = await makeSafetyRoot(t)
  const secret = 'FAKE_PRIVATE_CONFIG_SENTINEL_7f3a'
  const configPath = path.join(rootDir, 'tools', 'config.yaml')
  const source = path.join(rootDir, 'docs', 'zh-cn', 'index.md')
  await writeFile(configPath, secret, 'utf8')
  await link(configPath, source)

  const error = await captureReadError(
    readSafeMarkdownSource(source, { rootDir, protectedIdentities: new Set() })
  )
  assert.equal(error.code, SAFE_MARKDOWN_READ_FAILED)
  assert.match(error.message, /无法安全读取 Markdown 源文件/)
  assert.ok(!error.message.includes(secret))
  assert.ok(!error.message.includes(configPath))
  assert.ok(!error.message.includes(source))
})

test('safe Markdown read uses historical protected identities after config replacement', async (t) => {
  const rootDir = await makeSafetyRoot(t)
  const oldSecret = 'OLD_FAKE_CONFIG_SENTINEL_3d11'
  const newSecret = 'NEW_FAKE_CONFIG_SENTINEL_3d12'
  const configPath = path.join(rootDir, 'tools', 'config.yaml')
  const safeSource = path.join(rootDir, 'docs', 'zh-cn', 'safe.md')
  const oldIdentitySource = path.join(rootDir, 'docs', 'zh-cn', 'old-secret.md')
  await writeFile(configPath, oldSecret, 'utf8')
  await writeFile(safeSource, '# 安全页面\n', 'utf8')
  await link(configPath, oldIdentitySource)

  const identities = new Set()
  assert.equal(
    await readSafeMarkdownSource(safeSource, { rootDir, protectedIdentities: identities }),
    '# 安全页面\n'
  )
  assert.ok(identities.size > 0)

  const { unlink } = await import('node:fs/promises')
  await unlink(configPath)
  await writeFile(configPath, newSecret, 'utf8')

  const error = await captureReadError(
    readSafeMarkdownSource(oldIdentitySource, { rootDir, protectedIdentities: identities })
  )
  assert.equal(error.code, SAFE_MARKDOWN_READ_FAILED)
  assert.ok(!error.message.includes(oldSecret))
  assert.ok(!error.message.includes(newSecret))
})

test('safe Markdown read protects AI_MODEL_CONFIG identities', async (t) => {
  const rootDir = await makeSafetyRoot(t)
  const secret = 'ENV_FAKE_CONFIG_SENTINEL_91ac'
  const envConfig = path.join(rootDir, 'external-config.yaml')
  const source = path.join(rootDir, 'docs', 'zh-cn', 'env-secret.md')
  await writeFile(envConfig, secret, 'utf8')
  await link(envConfig, source)
  const previousEnv = process.env.AI_MODEL_CONFIG
  process.env.AI_MODEL_CONFIG = envConfig
  t.after(() => {
    if (previousEnv === undefined) delete process.env.AI_MODEL_CONFIG
    else process.env.AI_MODEL_CONFIG = previousEnv
  })

  const error = await captureReadError(
    readSafeMarkdownSource(source, { rootDir, protectedIdentities: new Set() })
  )
  assert.equal(error.code, SAFE_MARKDOWN_READ_FAILED)
  assert.ok(!error.message.includes(secret))
})

test('safe Markdown read rejects symlinked sources and parent directories', async (t) => {
  const rootDir = await makeSafetyRoot(t)
  const realSource = path.join(rootDir, 'docs', 'zh-cn', 'real.md')
  const linkedSource = path.join(rootDir, 'docs', 'zh-cn', 'linked.md')
  await writeFile(realSource, '# 安全页面\n', 'utf8')
  try {
    await symlink(realSource, linkedSource)
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'EINVAL'].includes(error.code)) {
      t.skip('symlink creation is not available on this platform')
      return
    }
    throw error
  }

  const error = await captureReadError(
    readSafeMarkdownSource(linkedSource, { rootDir, protectedIdentities: new Set() })
  )
  assert.equal(error.code, SAFE_MARKDOWN_READ_FAILED)
})

test('safe Markdown read rejects a symlinked parent directory', async (t) => {
  const rootDir = await makeSafetyRoot(t)
  const realDirectory = path.join(rootDir, 'real-docs')
  const linkedDirectory = path.join(rootDir, 'docs', 'linked-parent')
  await mkdir(realDirectory, { recursive: true })
  await writeFile(path.join(realDirectory, 'page.md'), '# 安全页面\n', 'utf8')
  try {
    await symlink(
      realDirectory,
      linkedDirectory,
      process.platform === 'win32' ? 'junction' : 'dir'
    )
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'EINVAL'].includes(error.code)) {
      t.skip('directory link creation is not available on this platform')
      return
    }
    throw error
  }

  const error = await captureReadError(
    readSafeMarkdownSource(path.join(linkedDirectory, 'page.md'), {
      rootDir,
      protectedIdentities: new Set()
    })
  )
  assert.equal(error.code, SAFE_MARKDOWN_READ_FAILED)
})
