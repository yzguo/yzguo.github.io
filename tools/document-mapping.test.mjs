import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hasCjk,
  isPathInside,
  localizeInternalHref,
  rootDocumentTargetName
} from './document-mapping.mjs'

test('only explicitly Chinese root filenames become translation sources', () => {
  assert.equal(rootDocumentTargetName('README.zh-CN.md'), null)
  assert.equal(rootDocumentTargetName('README.md'), null)
  assert.equal(rootDocumentTargetName('notes.en.md'), null)
  assert.equal(rootDocumentTargetName('English-notes.md'), null)
  assert.equal(rootDocumentTargetName('网站问题排查与优化方案.md'), '网站问题排查与优化方案.en.md')
  assert.equal(rootDocumentTargetName('说明.zh-CN.md'), '说明.md')
  assert.equal(rootDocumentTargetName('说明.zh-cn.md'), '说明.md')
  assert.equal(rootDocumentTargetName('说明.en.md'), null)
})

test('Chinese proper names inside content do not mark an English filename', () => {
  assert.equal(hasCjk('提到郭彦禛'), true)
  assert.equal(hasCjk('English text'), false)
  assert.equal(rootDocumentTargetName('English.md'), null)
})

test('internal /zh-cn/ targets are localized without touching external URLs', () => {
  assert.equal(localizeInternalHref('/zh-cn/Notes/'), '/Notes/')
  assert.equal(localizeInternalHref('/zh-cn'), '/')
  assert.equal(localizeInternalHref('/zh-cn?x=1'), '/?x=1')
  assert.equal(localizeInternalHref('/zh-cn#top'), '/#top')
  assert.equal(localizeInternalHref('/Notes/'), '/Notes/')
  assert.equal(localizeInternalHref('https://example.com/zh-cn/'), 'https://example.com/zh-cn/')
  assert.equal(localizeInternalHref('zh-cn/Notes/'), 'zh-cn/Notes/')
})

test('path containment rejects traversal and absolute siblings', () => {
  assert.equal(isPathInside('D:/site', 'D:/site/docs/index.md'), true)
  assert.equal(isPathInside('D:/site', 'D:/site'), true)
  assert.equal(isPathInside('D:/site', 'D:/site2/index.md'), false)
  assert.equal(isPathInside('D:/site', 'D:/other/index.md'), false)
})
