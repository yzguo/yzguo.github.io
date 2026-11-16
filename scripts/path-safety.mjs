import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { isPathInside } from './document-mapping.mjs'

function operations(fs = {}) {
  return {
    lstat: fs.lstat ?? lstat,
    realpath: fs.realpath ?? realpath
  }
}

export async function resolveRealRoot(rootDir, fs = {}) {
  const ops = operations(fs)
  const resolved = path.resolve(rootDir)
  try {
    return await ops.realpath(resolved)
  } catch (error) {
    throw new Error(`无法解析仓库根目录的真实路径：${error.code ?? error.message}`)
  }
}

// Walks every component between rootDir and targetPath. Any symbolic link or
// Windows junction/reparse point is rejected, and a resolved existing path must
// still be inside the real root. Repeated calls are made immediately around
// read/write operations; this narrows, but cannot completely eliminate, TOCTOU
// races on filesystems without directory-handle-relative open semantics.
export async function assertSafePath(rootDir, targetPath, options = {}) {
  const ops = operations(options.fs)
  const label = options.label ?? '路径'
  const allowMissing = options.allowMissing === true
  const requireFile = options.requireFile === true
  const rootAbs = path.resolve(rootDir)
  const targetAbs = path.resolve(targetPath)

  if (!isPathInside(rootAbs, targetAbs)) {
    throw new Error(`${label} 不在仓库目录内：${targetAbs}`)
  }

  let rootReal
  try {
    rootReal = await ops.realpath(rootAbs)
  } catch (error) {
    throw new Error(`无法解析仓库根目录：${error.code ?? error.message}`)
  }

  const relative = path.relative(rootAbs, targetAbs)
  const safeTarget = relative === '' ? rootReal : path.join(rootReal, relative)
  if (!isPathInside(rootReal, safeTarget)) {
    throw new Error(`${label} 的真实路径越出仓库目录`)
  }
  if (relative === '') return safeTarget

  const parts = relative.split(path.sep).filter(Boolean)
  let current = rootReal
  let missing = false

  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index])
    let info
    try {
      info = await ops.lstat(current)
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(`${label} 无法检查路径：${error.code ?? error.message}`)
      }
      if (!allowMissing) throw new Error(`${label} 不存在`)
      missing = true
      break
    }

    if (info.isSymbolicLink()) {
      throw new Error(`${label} 的路径包含符号链接或 junction，拒绝继续`)
    }
    const last = index === parts.length - 1
    if (!last && !info.isDirectory()) {
      throw new Error(`${label} 的父路径不是目录`)
    }
    if (last && requireFile && !info.isFile()) {
      throw new Error(`${label} 不是普通文件`)
    }
  }

  if (!missing) {
    let realTarget
    try {
      realTarget = await ops.realpath(safeTarget)
    } catch (error) {
      throw new Error(`${label} 无法解析真实路径：${error.code ?? error.message}`)
    }
    if (!isPathInside(rootReal, realTarget)) {
      throw new Error(`${label} 的真实路径越出仓库目录`)
    }
  }

  return safeTarget
}

export async function assertSafeDirectory(rootDir, dirPath, fs = {}) {
  const safe = await assertSafePath(rootDir, dirPath, {
    allowMissing: false,
    requireFile: false,
    label: '输出目录',
    fs
  })
  const ops = operations(fs)
  let info
  try {
    info = await ops.lstat(safe)
  } catch (error) {
    throw new Error(`输出目录无法检查：${error.code ?? error.message}`)
  }
  if (!info.isDirectory()) throw new Error('输出目录不是目录')
  return safe
}
