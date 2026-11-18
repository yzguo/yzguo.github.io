import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canonicalInternalHref,
  hasCjk,
  isLocalePrefixedHref,
  isPathInside,
  localizeInternalHref,
  rootDocumentTargetName,
  rootDocumentTargets
} from './document-mapping.mjs'

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
