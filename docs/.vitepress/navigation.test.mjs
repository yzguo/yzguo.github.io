import assert from 'node:assert/strict'
import { link, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildLocaleNavigation, buildNotesCatalog } from './navigation.mjs'
import { resetPrivateConfigIdentityHistory } from './navigation-safe-fs.mjs'

const locales = ['en', 'zh-cn', 'zh-tw']

async function createRepo(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'yzguo-navigation-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const docs = path.join(root, 'docs')
  for (const locale of locales) {
    await mkdir(path.join(docs, locale, 'Notes'), { recursive: true })
  }
  return { root, docs }
}

async function writeTriple(docs, relativePath, texts) {
  for (const locale of locales) {
    const target = path.join(docs, locale, relativePath)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, texts[locale], 'utf8')
  }
}

const notesIndex = {
  en: '# Notes\n\n<NotesIndex />\n',
  'zh-cn': '# 笔记\n\n<NotesIndex />\n',
  'zh-tw': '# 筆記\n\n<NotesIndex />\n'
}

const options = (docs, root, extra = {}) => ({
  docsRoot: docs,
  cwd: root,
  env: {},
  ...extra
})

test('ordinary trilingual pages still produce nav and Notes excerpts', async (t) => {
  resetPrivateConfigIdentityHistory()
  const { root, docs } = await createRepo(t)
  await writeTriple(docs, 'Notes/index.md', notesIndex)
  await writeTriple(docs, 'Notes/Courses/index.md', {
    en: '# Course notes\n\nPublic course summary.\n',
    'zh-cn': '# 课程笔记\n\n公开课程摘要。\n',
    'zh-tw': '# 課程筆記\n\n公開課程摘要。\n'
  })
  await writeTriple(docs, 'Notes/Courses/demo.md', {
    en: '# Demo note\n\nPublic demo paragraph.\n',
    'zh-cn': '# 演示笔记\n\n公开演示段落。\n',
    'zh-tw': '# 示範筆記\n\n公開示範段落。\n'
  })
  await writeTriple(docs, 'Notes/Courses/public.md', {
    en: '---\nprivate: false\ndraft: false\n---\n# Explicit public note\n\nPublic flags.\n',
    'zh-cn': '---\nprivate: false\ndraft: false\n---\n# 显式公开笔记\n\n公开标记。\n',
    'zh-tw': '---\nprivate: false\ndraft: false\n---\n# 顯式公開筆記\n\n公開標記。\n'
  })

  const navigation = buildLocaleNavigation('en', options(docs, root))
  assert.equal(navigation.nav.length, 1)
  assert.equal(navigation.nav[0].text, 'Notes')
  assert.equal(navigation.nav[0].link, '/en/Notes/')
  const notes = navigation.sidebar['/en/Notes/']
  assert.equal(notes[0].text, 'Notes')
  assert.equal(notes[0].items[0].text, 'Course notes')
  assert.deepEqual(
    notes[0].items[0].items.map((item) => item.text),
    ['Demo note', 'Explicit public note']
  )
  assert.equal(notes[0].items[0].items[0].link, '/en/Notes/Courses/demo')

  const catalog = buildNotesCatalog(options(docs, root))
  assert.equal(catalog.titles['zh-cn'], '笔记')
  assert.equal(catalog.children[0].titles['zh-tw'], '課程筆記')
  assert.equal(
    catalog.children[0].children[0].excerpts['zh-tw'],
    '公開示範段落。'
  )
})

test('a closed private block is stripped, including from titles and excerpts', async (t) => {
  resetPrivateConfigIdentityHistory()
  const { root, docs } = await createRepo(t)
  const sentinel = 'NAV_PRIVATE_SENTINEL_7f7f'
  await writeTriple(docs, 'Notes/index.md', notesIndex)
  await writeTriple(docs, 'Notes/Private/index.md', {
    en: `# Visible section\n\nPublic introduction.\n\n<!-- private:start -->\n${sentinel}\n<!-- private:end -->\n`,
    'zh-cn': `# 可见分区\n\n公开简介。\n\n<!-- private:start -->\n${sentinel}\n<!-- private:end -->\n`,
    'zh-tw': `# 可見分區\n\n公開簡介。\n\n<!-- private:start -->\n${sentinel}\n<!-- private:end -->\n`
  })

  const fullyPrivate = 'NAV_FULLY_PRIVATE_SENTINEL_1a1a'
  await writeTriple(docs, 'Notes/Private/only-private.md', {
    en: `<!-- private:start -->\n# Hidden title\n\n${fullyPrivate}\n<!-- private:end -->\n`,
    'zh-cn': `<!-- private:start -->\n# 隐藏标题\n\n${fullyPrivate}\n<!-- private:end -->\n`,
    'zh-tw': `<!-- private:start -->\n# 隱藏標題\n\n${fullyPrivate}\n<!-- private:end -->\n`
  })

  const catalog = buildNotesCatalog(options(docs, root))
  const serializedCatalog = JSON.stringify(catalog)
  assert.ok(!serializedCatalog.includes(sentinel))
  assert.ok(!serializedCatalog.includes(fullyPrivate))
  assert.equal(catalog.children[0].titles.en, 'Visible section')
  assert.equal(catalog.children[0].excerpts.en, 'Public introduction.')
  assert.equal(catalog.children[0].children.length, 0)

  for (const locale of locales) {
    const navigation = buildLocaleNavigation(locale, options(docs, root))
    const text = JSON.stringify(navigation)
    assert.ok(!text.includes(sentinel))
    assert.ok(!text.includes('Hidden title'))
    assert.ok(!text.includes('Only private'))
  }
})

test('ambiguous draft/private flags and YAML anchors hide the page', async (t) => {
  resetPrivateConfigIdentityHistory()
  const { root, docs } = await createRepo(t)
  await writeTriple(docs, 'Notes/index.md', notesIndex)
  await writeTriple(docs, 'Notes/Courses/index.md', {
    en: '# Course notes\n\nPublic.\n',
    'zh-cn': '# 课程笔记\n\n公开。\n',
    'zh-tw': '# 課程筆記\n\n公開。\n'
  })

  const maybe = 'NAV_MAYBE_SENTINEL_9c1c'
  await writeTriple(docs, 'Notes/Courses/maybe.md', {
    en: `---\nprivate: maybe\n---\n# Maybe leak\n\n${maybe}\n`,
    'zh-cn': `---\nprivate: maybe\n---\n# 可能泄露\n\n${maybe}\n`,
    'zh-tw': `---\nprivate: maybe\n---\n# 可能洩漏\n\n${maybe}\n`
  })

  const draft = 'NAV_DRAFT_SENTINEL_3a3a'
  await writeTriple(docs, 'Notes/Courses/draft.md', {
    en: `---\ndraft:\n---\n# Draft leak\n\n${draft}\n`,
    'zh-cn': `---\ndraft:\n---\n# 草稿泄露\n\n${draft}\n`,
    'zh-tw': `---\ndraft:\n---\n# 草稿洩漏\n\n${draft}\n`
  })

  const anchor = 'NAV_ANCHOR_SENTINEL_5e5e'
  await writeTriple(docs, 'Notes/Courses/anchor.md', {
    en: `---\nbase: &base\n  title: Anchored\ntitle: *base\n---\n# Anchor leak\n\n${anchor}\n`,
    'zh-cn': `---\nbase: &base\n  title: Anchored\ntitle: *base\n---\n# 锚点泄露\n\n${anchor}\n`,
    'zh-tw': `---\nbase: &base\n  title: Anchored\ntitle: *base\n---\n# 錨點洩漏\n\n${anchor}\n`
  })

  const catalog = buildNotesCatalog(options(docs, root))
  const serialized = JSON.stringify(catalog)
  assert.ok(!serialized.includes(maybe))
  assert.ok(!serialized.includes(draft))
  assert.ok(!serialized.includes(anchor))
  assert.ok(!serialized.includes('Maybe leak'))
  assert.ok(!serialized.includes('Draft leak'))
  assert.ok(!serialized.includes('Anchor leak'))

  for (const locale of locales) {
    const navigation = buildLocaleNavigation(locale, options(docs, root))
    const text = JSON.stringify(navigation)
    assert.ok(!text.includes(maybe))
    assert.ok(!text.includes(draft))
    assert.ok(!text.includes(anchor))
  }
})

test('a document hardlinked to the private configuration is not read', async (t) => {
  resetPrivateConfigIdentityHistory()
  const { root, docs } = await createRepo(t)
  const sentinel = 'FAKE_NAV_CONFIG_SECRET_2b2b'
  await writeTriple(docs, 'Notes/index.md', notesIndex)
  await writeTriple(docs, 'Notes/Courses/index.md', {
    en: '# Course notes\n\nPublic.\n',
    'zh-cn': '# 课程笔记\n\n公开。\n',
    'zh-tw': '# 課程筆記\n\n公開。\n'
  })
  await writeTriple(docs, 'Notes/Courses/hardlink.md', {
    en: '# Safe target\n\nPublic target.\n',
    'zh-cn': '# 安全目标\n\n公开目标。\n',
    'zh-tw': '# 安全目標\n\n公開目標。\n'
  })

  const configPath = path.join(root, 'tools', 'config.yaml')
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(
    configPath,
    `# Hardlink page\n\n${sentinel}\napiKey: fake-not-a-real-key\n`,
    'utf8'
  )

  const sourcePage = path.join(docs, 'zh-cn', 'Notes', 'Courses', 'hardlink.md')
  await rm(sourcePage)
  try {
    await link(configPath, sourcePage)
  } catch (error) {
    t.skip(`Hardlinks are unavailable here: ${error.code ?? error.message}`)
    return
  }

  const navigation = buildLocaleNavigation('en', options(docs, root))
  const catalog = buildNotesCatalog(options(docs, root))
  assert.ok(!JSON.stringify(navigation).includes(sentinel))
  assert.ok(!JSON.stringify(catalog).includes(sentinel))
  assert.ok(!JSON.stringify(navigation).includes('Hardlink page'))
  assert.ok(!JSON.stringify(catalog).includes('Hardlink page'))
})

test('an injected fs directory-symlink report fails closed', async (t) => {
  resetPrivateConfigIdentityHistory()
  const { root, docs } = await createRepo(t)
  const sentinel = 'NAV_SYMLINK_SENTINEL_4d4d'
  await writeTriple(docs, 'Notes/index.md', notesIndex)
  await writeTriple(docs, 'Notes/Courses/index.md', {
    en: `# Course notes\n\n${sentinel}\n`,
    'zh-cn': `# 课程笔记\n\n${sentinel}\n`,
    'zh-tw': `# 課程筆記\n\n${sentinel}\n`
  })

  const realFs = await import('node:fs')
  const notesDirectory = path.resolve(docs, 'zh-cn', 'Notes')
  const fakeFs = {
    lstatSync(target, fsOptions) {
      if (path.resolve(target) === notesDirectory) {
        return {
          isSymbolicLink: () => true,
          isDirectory: () => false,
          isFile: () => false
        }
      }
      return realFs.lstatSync(target, fsOptions)
    },
    readdirSync: realFs.readdirSync,
    realpathSync: realFs.realpathSync,
    statSync: realFs.statSync,
    openSync: realFs.openSync,
    fstatSync: realFs.fstatSync,
    closeSync: realFs.closeSync,
    readFileSync: realFs.readFileSync,
    constants: realFs.constants
  }

  const navigation = buildLocaleNavigation(
    'en',
    options(docs, root, { fs: fakeFs })
  )
  const catalog = buildNotesCatalog(options(docs, root, { fs: fakeFs }))
  assert.ok(!JSON.stringify(navigation).includes(sentinel))
  assert.equal(catalog, null)
  assert.deepEqual(navigation.nav, [])
  assert.deepEqual(navigation.sidebar, {})
})
