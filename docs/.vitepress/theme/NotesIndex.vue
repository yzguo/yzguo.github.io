<script setup lang="ts">
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'
import { data as notesCatalog } from '../navigation.data.mjs'

interface NotesNode {
    type: 'section' | 'page'
    key: string
    hasIndex: boolean
    titles: Record<string, string>
    excerpts: Record<string, string>
    children: NotesNode[]
}

type LocaleKey = 'en' | 'zh-cn' | 'zh-tw'

const { lang, page } = useData()

const labels: Record<LocaleKey, string> = {
    en: 'Notes in this section',
    'zh-cn': '本节的笔记',
    'zh-tw': '本節的筆記'
}

function localeFromLang(value: string): LocaleKey {
    const normalized = String(value || '').toLowerCase()
    if (
        normalized === 'zh-tw' ||
        normalized.startsWith('zh-tw-') ||
        normalized.startsWith('zh-hk') ||
        normalized.startsWith('zh-mo') ||
        normalized.startsWith('zh-hant')
    ) {
        return 'zh-tw'
    }
    if (normalized.startsWith('zh')) return 'zh-cn'
    return 'en'
}

const locale = computed(() => localeFromLang(lang.value))

// `page.relativePath` is available during SSR and on the client. The data
// catalog uses locale-independent keys such as `Notes/Courses`, so the same
// index page resolves in every edition.
const pageKey = computed(() => {
    const relativePath = page.value.relativePath.replace(/\\/g, '/')
    return relativePath
        .replace(/^(en|zh-cn|zh-tw)\//, '')
        .replace(/\/index\.md$/, '')
        .replace(/^index\.md$/, '')
        .replace(/\.md$/, '')
})

function findNode(node: NotesNode | null, key: string): NotesNode | null {
    if (!node) return null
    if (node.key === key) return node
    for (const child of node.children) {
        const found = findNode(child, key)
        if (found) return found
    }
    return null
}

const current = computed(() => (
    findNode(notesCatalog as NotesNode | null, pageKey.value)
))

// A directory without an index.md has no landing URL. Flatten such a group
// into its parent list so every rendered card links to a real page instead of
// guessing a directory URL. content:sync normally creates the missing index.
function flattenItems(nodes: NotesNode[]): NotesNode[] {
    const result: NotesNode[] = []
    for (const node of nodes) {
        if (node.type === 'section' && !node.hasIndex) {
            result.push(...flattenItems(node.children))
        } else {
            result.push(node)
        }
    }
    return result
}

const items = computed(() => flattenItems(current.value?.children ?? []))

function itemTitle(item: NotesNode): string {
    return (
        item.titles?.[locale.value] ||
        item.titles?.en ||
        item.key.split('/').pop() ||
        item.key
    )
}

function itemExcerpt(item: NotesNode): string {
    return item.excerpts?.[locale.value] || ''
}

function itemHref(item: NotesNode): string {
    const suffix = item.type === 'section' ? '/' : ''
    return withBase(`/${locale.value}/${item.key}${suffix}`)
}
</script>

<template>
    <nav
        v-if="items.length > 0"
        class="notes-index"
        :aria-label="labels[locale]"
    >
        <ul class="notes-index__list">
            <li
                v-for="item in items"
                :key="item.key"
                class="notes-index__item"
                :class="`notes-index__item--${item.type}`"
            >
                <a class="notes-index__link" :href="itemHref(item)">
                    <span class="notes-index__title">{{ itemTitle(item) }}</span>
                    <span
                        v-if="itemExcerpt(item)"
                        class="notes-index__excerpt"
                    >{{ itemExcerpt(item) }}</span>
                </a>
            </li>
        </ul>
    </nav>
</template>

<style scoped>
.notes-index {
    margin: 1.5rem 0;
}

.notes-index__list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    list-style: none;
}

.notes-index__link {
    display: block;
    padding: 0.875rem 1rem;
    border: 1px solid var(--vp-c-divider);
    border-radius: 8px;
    text-decoration: none;
    transition: border-color 0.2s, background-color 0.2s;
}

.notes-index__link:hover {
    border-color: var(--vp-c-brand-1);
    background-color: var(--vp-c-bg-soft);
}

.notes-index__title {
    color: var(--vp-c-text-1);
    font-weight: 600;
    overflow-wrap: anywhere;
}

.notes-index__excerpt {
    display: block;
    margin-top: 0.25rem;
    color: var(--vp-c-text-2);
    font-size: 0.875rem;
    line-height: 1.6;
    overflow-wrap: anywhere;
}
</style>
