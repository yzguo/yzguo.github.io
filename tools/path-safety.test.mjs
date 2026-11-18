import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { assertSafeDirectory, assertSafePath, resolveRealRoot } from './path-safety.mjs'

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
