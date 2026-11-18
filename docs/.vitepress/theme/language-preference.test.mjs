import assert from 'node:assert/strict'
import test from 'node:test'
import {
    normalizeBase,
    resolveRootRedirect,
    selectLocale
} from './language-preference.mjs'

test('selectLocale maps Traditional Chinese variants to zh-tw', () => {
    for (const tag of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-Hant-TW']) {
        assert.equal(selectLocale([tag]), 'zh-tw', tag)
    }
})

test('selectLocale maps other Chinese variants to zh-cn', () => {
    for (const tag of ['zh', 'zh-CN', 'zh-Hans', 'zh-SG', 'zh-Hans-CN']) {
        assert.equal(selectLocale([tag]), 'zh-cn', tag)
    }
})

test('selectLocale maps non-Chinese languages to English', () => {
    for (const tag of ['en-US', 'fr-FR', 'ja-JP', '']) {
        assert.equal(selectLocale([tag]), 'en', tag)
    }
    assert.equal(selectLocale([]), 'en')
    assert.equal(selectLocale(undefined), 'en')
})

test('selectLocale uses only the first preferred language', () => {
    assert.equal(selectLocale(['fr-FR', 'zh-TW']), 'en')
    assert.equal(selectLocale(['zh-TW', 'en-US']), 'zh-tw')
})

test('normalizeBase always returns a leading and trailing slash', () => {
    assert.equal(normalizeBase('/'), '/')
    assert.equal(normalizeBase('/repo'), '/repo/')
    assert.equal(normalizeBase('repo/'), '/repo/')
    assert.equal(normalizeBase(''), '/')
})

test('resolveRootRedirect preserves query and hash', () => {
    assert.equal(
        resolveRootRedirect({
            pathname: '/',
            search: '?from=home',
            hash: '#welcome',
            languages: ['zh-TW'],
            base: '/'
        }),
        '/zh-tw/?from=home#welcome'
    )
    assert.equal(
        resolveRootRedirect({
            pathname: '/index.html',
            search: '?a=1',
            hash: '',
            languages: ['en-GB'],
            base: '/'
        }),
        '/en/?a=1'
    )
})

test('resolveRootRedirect honours a configured base path', () => {
    assert.equal(
        resolveRootRedirect({
            pathname: '/repo/',
            search: '',
            hash: '',
            languages: ['zh-CN'],
            base: '/repo/'
        }),
        '/repo/zh-cn/'
    )
})

test('resolveRootRedirect never redirects language pages', () => {
    for (const pathname of ['/en/', '/zh-cn/About/', '/zh-tw/Notes/']) {
        assert.equal(
            resolveRootRedirect({
                pathname,
                languages: ['zh-TW'],
                base: '/'
            }),
            null,
            pathname
        )
    }
})

test('resolveRootRedirect does not return the current URL', () => {
    assert.equal(
        resolveRootRedirect({
            pathname: '/en/',
            languages: ['en-US'],
            base: '/'
        }),
        null
    )
})
