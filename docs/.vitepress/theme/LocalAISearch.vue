<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useRoute } from 'vitepress'

interface AiSource {
    title: string
    heading: string
    url: string
}

type Outcome =
    | 'idle'
    | 'answer'
    | 'no_results'
    | 'model_error'
    | 'busy'
    | 'request_error'
    | 'cancelled'

declare const __AI_SEARCH_ENABLED__: boolean

// index.ts imports this component only when the resolved dev-server switch is
// true. The compile-time guard below is defense in depth if the component is
// imported directly; the endpoint also refuses requests independently.
const enabled = __AI_SEARCH_ENABLED__

const AI_SEARCH_PATH = '/__ai-search'

// The server/model timeout defaults to 300000ms. This finite 15-minute hard
// stop only covers a hung dev server; a normal server timeout produces an
// explicit error at 300 seconds. Keep AI_REQUEST_TIMEOUT_MS below this bound.
const REQUEST_TIMEOUT_MS = 900_000

const route = useRoute()

/**
 * The public locale is defined by the route prefix, not by the browser or the
 * document language. `/zh-tw/` is Traditional Chinese, `/zh-cn/` is Simplified
 * Chinese, and every other path (including `/`, `/en/`, and unknown
 * languages) uses the English interface and English model answers.
 */
function localeForPath(path: string): 'en' | 'zh-cn' | 'zh-tw' {
    const normalized = path.toLowerCase()
    if (normalized === '/zh-tw' || normalized.startsWith('/zh-tw/')) {
        return 'zh-tw'
    }
    if (normalized === '/zh-cn' || normalized.startsWith('/zh-cn/')) {
        return 'zh-cn'
    }
    return 'en'
}

const isOpen = ref(false)
const query = ref('')
const loading = ref(false)
const outcome = ref<Outcome>('idle')
const answer = ref('')
const sources = ref<AiSource[]>([])
const errorMessage = ref('')
const input = ref<HTMLInputElement | null>(null)

let requestController: AbortController | null = null
let previousFocus: HTMLElement | null = null
let previousOverflow = ''
let timeoutHandle: ReturnType<typeof setTimeout> | undefined

const searchLocale = computed(() => localeForPath(route.path))
const titleId = 'local-ai-search-title-' + useId().replace(/[^a-zA-Z0-9-]/g, '')
const inputId = 'local-ai-search-query-' + useId().replace(/[^a-zA-Z0-9-]/g, '')

const labels = computed(() => {
    if (searchLocale.value === 'zh-tw') {
        return {
            trigger: 'AI 搜尋',
            triggerMark: 'AI',
            triggerText: '搜尋',
            title: '用 AI 搜尋本站',
            close: '關閉',
            inputLabel: '問題',
            placeholder: '詢問本站的公開文件…',
            ask: '提問',
            asking: '思考中…',
            cancel: '取消',
            note: 'AI 搜尋僅在本機開發伺服器啟用。問題與選取的公開頁面摘錄只會傳送到本機設定的 AI 模型；線上靜態網站不提供此功能。',
            loading: '正在檢索站內公開文件並請求本機 AI 模型…',
            noResults: '沒有找到符合的公開頁面。可以試試原有的搜尋（Ctrl/Cmd+K）。',
            modelError: '本機 AI 模型暫時無法回答。原有的搜尋仍然可用。',
            busy: '本機 AI 模型正在回答另一個問題，請稍後再試。原有的搜尋仍然可用。',
            requestError: '無法連線到本機 AI 搜尋。原有的搜尋仍然可用。',
            timeout: 'AI 模型回應逾時。原有的搜尋仍然可用。',
            cancelled: '已取消 AI 回答請求。',
            sources: '來源',
        }
    }

    if (searchLocale.value === 'zh-cn') {
        return {
            trigger: 'AI 搜索',
            triggerMark: 'AI',
            triggerText: '搜索',
            title: '用 AI 搜索本站',
            close: '关闭',
            inputLabel: '问题',
            placeholder: '询问本站的公开文档…',
            ask: '提问',
            asking: '思考中…',
            cancel: '取消',
            note: 'AI 搜索仅在本机开发服务器启用。问题与选中的公开页面摘录只会发送到本机配置的 AI 模型；线上静态站点不提供此功能。',
            loading: '正在检索站内公开文档并请求本机 AI 模型…',
            noResults: '没有找到匹配的公开页面。可以试试原有的搜索（Ctrl/Cmd+K）。',
            modelError: '本机 AI 模型暂时无法回答。原有的搜索仍然可用。',
            busy: '本机 AI 模型正在回答另一个问题，请稍后再试。原有的搜索仍然可用。',
            requestError: '无法连接本机 AI 搜索。原有的搜索仍然可用。',
            timeout: 'AI 模型响应超时。原有的搜索仍然可用。',
            cancelled: '已取消 AI 回答请求。',
            sources: '来源',
        }
    }

    return {
        trigger: 'AI search',
        triggerMark: 'AI',
        triggerText: 'Search',
        title: 'Search this site with AI',
        close: 'Close',
        inputLabel: 'Question',
        placeholder: 'Ask about this site’s public documentation…',
        ask: 'Ask',
        asking: 'Thinking…',
        cancel: 'Cancel',
        note: 'AI search is available only on the local development server. The question and selected public page excerpts are sent only to the AI model configured on this computer; the public static site does not offer this feature.',
        loading: 'Searching public site pages and asking the local AI model…',
        noResults: 'No matching public page was found. Try the normal search (Ctrl/Cmd+K).',
        modelError: 'The local AI model could not answer. The normal search is still available.',
        busy: 'The local AI model is answering another question. Try again in a moment; the normal search is still available.',
        requestError: 'The local AI search could not be reached. The normal search is still available.',
        timeout: 'The AI model took too long to answer. The normal search is still available.',
        cancelled: 'AI answer request cancelled.',
        sources: 'Sources',
    }
})

const canSubmit = computed(
    () => query.value.trim().length >= 2 && !loading.value
)

function cleanText(value: unknown, maximum: number): string {
    if (typeof value !== 'string') return ''
    return value
        .replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maximum)
}

/**
 * The server only emits same-site paths, but the client validates again and
 * renders labels as text. No model output is ever inserted as HTML.
 */
function sanitizeSources(value: unknown): AiSource[] {
    if (!Array.isArray(value) || typeof window === 'undefined') return []

    const origin = window.location.origin
    const seen = new Set<string>()
    const result: AiSource[] = []

    for (const item of value) {
        if (!item || typeof item !== 'object') continue
        const candidate = item as {
            title?: unknown
            heading?: unknown
            url?: unknown
        }
        const url = typeof candidate.url === 'string' ? candidate.url : ''
        if (
            !url.startsWith('/') ||
            url.startsWith('//') ||
            url.includes('\\') ||
            /[\u0000-\u001F\u007F\s]/u.test(url)
        ) {
            continue
        }

        let parsed: URL
        try {
            parsed = new URL(url, origin)
        } catch {
            continue
        }
        if (parsed.origin !== origin) continue

        const normalized = parsed.pathname + parsed.search + parsed.hash
        if (!normalized.startsWith('/') || normalized.startsWith('//')) continue
        if (seen.has(normalized)) continue
        seen.add(normalized)

        result.push({
            url: normalized,
            title: cleanText(candidate.title, 160) || normalized,
            heading: cleanText(candidate.heading, 160),
        })
        if (result.length >= 5) break
    }

    return result
}

function cancelRequest() {
    if (requestController) {
        requestController.abort()
        requestController = null
    }
    if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle)
        timeoutHandle = undefined
    }
    loading.value = false
}

/** Stop an in-flight answer and show explicit cancellation feedback. */
function cancelAnswer() {
    if (!loading.value) return
    cancelRequest()
    outcome.value = 'cancelled'
    errorMessage.value = ''
}

function openDialog() {
    if (!enabled || isOpen.value) return
    previousFocus =
        typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null
    isOpen.value = true
    nextTick(() => input.value?.focus())
}

function closeDialog() {
    if (!isOpen.value) return
    isOpen.value = false
    cancelRequest()
    const focusTarget = previousFocus
    previousFocus = null
    if (focusTarget && focusTarget.isConnected) {
        nextTick(() => focusTarget.focus())
    }
}

async function ask() {
    const question = query.value.trim()
    if (!enabled || loading.value || question.length < 2) return

    cancelRequest()
    const controller = new AbortController()
    requestController = controller
    loading.value = true
    outcome.value = 'idle'
    answer.value = ''
    sources.value = []
    errorMessage.value = ''

    let timedOut = false
    timeoutHandle = setTimeout(() => {
        timedOut = true
        controller.abort()
    }, REQUEST_TIMEOUT_MS)

    try {
        const response = await fetch(AI_SEARCH_PATH, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: question,
                // The route prefix selects one of three independent indexes.
                // English and every other language stay English.
                lang: searchLocale.value,
            }),
            credentials: 'same-origin',
            cache: 'no-store',
            signal: controller.signal,
        })

        let payload: unknown = null
        try {
            payload = await response.json()
        } catch {
            payload = null
        }

        if (controller.signal.aborted) {
            if (timedOut) {
                outcome.value = 'request_error'
                errorMessage.value = labels.value.timeout
            }
            return
        }

        const body =
            payload && typeof payload === 'object'
                ? (payload as {
                      ok?: unknown
                      answer?: unknown
                      sources?: unknown
                      code?: unknown
                  })
                : null

        if (
            body &&
            body.ok === true &&
            typeof body.answer === 'string' &&
            body.answer.trim() !== ''
        ) {
            outcome.value = 'answer'
            answer.value = body.answer
            sources.value = sanitizeSources(body.sources)
            return
        }

        if (body && body.code === 'no_results') {
            outcome.value = 'no_results'
            return
        }

        if (body && body.code === 'model_error') {
            outcome.value = 'model_error'
            return
        }

        if (body && body.code === 'busy') {
            outcome.value = 'busy'
            return
        }

        if (body && body.code === 'timeout') {
            outcome.value = 'request_error'
            errorMessage.value = labels.value.timeout
            return
        }

        outcome.value = 'request_error'
        errorMessage.value = labels.value.requestError
    } catch {
        if (controller.signal.aborted) {
            if (timedOut) {
                outcome.value = 'request_error'
                errorMessage.value = labels.value.timeout
            }
            return
        }
        outcome.value = 'request_error'
        errorMessage.value = labels.value.requestError
    } finally {
        if (requestController === controller) {
            requestController = null
            if (timeoutHandle !== undefined) {
                clearTimeout(timeoutHandle)
                timeoutHandle = undefined
            }
            loading.value = false
        }
    }
}

function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && isOpen.value) {
        event.preventDefault()
        closeDialog()
    }
}

watch(isOpen, (open) => {
    if (typeof document === 'undefined') return
    if (open) {
        previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
    } else {
        document.body.style.overflow = previousOverflow
    }
})

watch(
    () => route.path,
    () => {
        if (isOpen.value) closeDialog()
    }
)

onMounted(() => {
    window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
    cancelRequest()
    if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', onKeydown)
    }
    if (typeof document !== 'undefined') {
        document.body.style.overflow = previousOverflow
    }
})
</script>

<template>
    <button
        v-if="enabled"
        class="local-ai-trigger"
        type="button"
        data-testid="ai-search-trigger"
        :aria-label="labels.trigger"
        :title="labels.trigger"
        @click="openDialog"
    >
        <span class="local-ai-trigger-mark" aria-hidden="true">{{ labels.triggerMark }}</span>
        <span class="local-ai-trigger-text">{{ labels.triggerText }}</span>
    </button>

    <Teleport v-if="enabled && isOpen" to="body">
        <div class="local-ai-overlay" @click.self="closeDialog">
            <section
                class="local-ai-dialog"
                role="dialog"
                aria-modal="true"
                :aria-labelledby="titleId"
                data-testid="ai-search-dialog"
                :aria-busy="loading ? 'true' : 'false'"
            >
                <header class="local-ai-header">
                    <div>
                        <p class="local-ai-eyebrow">AI</p>
                        <h2 :id="titleId" class="local-ai-title">{{ labels.title }}</h2>
                    </div>
                    <button
                        class="local-ai-close"
                        type="button"
                        data-testid="ai-search-close"
                        :aria-label="labels.close"
                        :title="labels.close"
                        @click="closeDialog"
                    >
                        <span aria-hidden="true">×</span>
                    </button>
                </header>

                <form class="local-ai-form" @submit.prevent="ask">
                    <label class="local-ai-sr-only" :for="inputId">{{ labels.inputLabel }}</label>
                    <input
                        :id="inputId"
                        ref="input"
                        v-model="query"
                        class="local-ai-input"
                        type="search"
                        data-testid="ai-search-query"
                        :placeholder="labels.placeholder"
                        :aria-label="labels.inputLabel"
                        maxlength="200"
                        autocomplete="off"
                        spellcheck="false"
                    />
                    <button
                        class="local-ai-submit"
                        type="submit"
                        data-testid="ai-search-submit"
                        :disabled="!canSubmit"
                    >
                        {{ loading ? labels.asking : labels.ask }}
                    </button>
                    <button
                        v-if="loading"
                        class="local-ai-cancel"
                        type="button"
                        data-testid="ai-search-cancel"
                        @click="cancelAnswer"
                    >
                        {{ labels.cancel }}
                    </button>
                </form>

                <p class="local-ai-note">{{ labels.note }}</p>

                <div class="local-ai-results" aria-live="polite">
                    <p
                        v-if="loading"
                        class="local-ai-status"
                        data-testid="ai-search-loading"
                    >
                        {{ labels.loading }}
                    </p>

                    <div v-else-if="outcome === 'answer'" class="local-ai-answer-wrap">
                        <div class="local-ai-answer" data-testid="ai-search-answer">{{ answer }}</div>

                        <nav
                            v-if="sources.length"
                            class="local-ai-sources"
                            data-testid="ai-search-sources"
                            :aria-label="labels.sources"
                        >
                            <h3 class="local-ai-sources-title">{{ labels.sources }}</h3>
                            <ul class="local-ai-source-list">
                                <li v-for="(source, index) in sources" :key="source.url + '-' + index">
                                    <a
                                        class="local-ai-source"
                                        data-testid="ai-search-source"
                                        :href="source.url"
                                    >
                                        <span class="local-ai-source-title">{{ source.title }}</span>
                                        <span
                                            v-if="source.heading && source.heading !== source.title"
                                            class="local-ai-source-heading"
                                        >{{ source.heading }}</span>
                                    </a>
                                </li>
                            </ul>
                        </nav>
                    </div>

                    <div
                        v-else-if="outcome === 'no_results'"
                        data-testid="ai-search-error"
                        data-result="no_results"
                    >
                        <p class="local-ai-status" data-testid="ai-search-no-results">
                            {{ labels.noResults }}
                        </p>
                    </div>

                    <p
                        v-else-if="outcome === 'model_error'"
                        class="local-ai-status local-ai-error"
                        data-testid="ai-search-error"
                        data-result="model_error"
                        role="alert"
                    >
                        {{ labels.modelError }}
                    </p>

                    <p
                        v-else-if="outcome === 'busy'"
                        class="local-ai-status"
                        data-testid="ai-search-error"
                        data-result="busy"
                        role="status"
                    >
                        {{ labels.busy }}
                    </p>

                    <p
                        v-else-if="outcome === 'request_error'"
                        class="local-ai-status local-ai-error"
                        data-testid="ai-search-error"
                        data-result="request_error"
                        role="alert"
                    >
                        {{ errorMessage || labels.requestError }}
                    </p>

                    <p
                        v-else-if="outcome === 'cancelled'"
                        class="local-ai-status"
                        data-testid="ai-search-cancelled"
                        data-result="cancelled"
                        role="status"
                    >
                        {{ labels.cancelled }}
                    </p>
                </div>
            </section>
        </div>
    </Teleport>
</template>

<style scoped>
.local-ai-trigger {
    position: fixed;
    right: 24px;
    bottom: 84px;
    z-index: 40;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 7px 12px 7px 9px;
    border: 1px solid var(--vp-c-divider, #e2e2e3);
    border-radius: 999px;
    background: var(--vp-c-bg-soft, #f6f6f7);
    color: var(--vp-c-text-1, #1f2328);
    box-shadow: 0 3px 12px rgba(0, 0, 0, 0.12);
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s, transform 0.2s;
}

.local-ai-trigger:hover {
    border-color: var(--vp-c-brand-1, #0078d4);
    color: var(--vp-c-brand-1, #0078d4);
    transform: translateY(-1px);
}

.local-ai-trigger:focus-visible,
.local-ai-close:focus-visible,
.local-ai-submit:focus-visible,
.local-ai-cancel:focus-visible,
.local-ai-source:focus-visible,
.local-ai-input:focus-visible {
    outline: 2px solid var(--vp-c-brand-1, #0078d4);
    outline-offset: 2px;
}

.local-ai-trigger-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    height: 20px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--vp-c-brand-1, #0078d4);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.02em;
}

.local-ai-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 8vh 16px 24px;
    overflow-y: auto;
    background: rgba(0, 0, 0, 0.48);
    overscroll-behavior: contain;
}

.local-ai-dialog {
    display: flex;
    flex-direction: column;
    width: min(680px, 100%);
    max-height: 82vh;
    padding: 22px;
    border: 1px solid var(--vp-c-divider, #e2e2e3);
    border-radius: 14px;
    background: var(--vp-c-bg, #fff);
    color: var(--vp-c-text-1, #1f2328);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.28);
    font-family: inherit;
}

.local-ai-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
}

.local-ai-eyebrow {
    margin: 0 0 4px;
    color: var(--vp-c-brand-1, #0078d4);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
}

.local-ai-title {
    margin: 0;
    border: 0;
    font-family: inherit;
    font-size: 20px;
    font-weight: 700;
    line-height: 1.3;
}

.local-ai-close {
    flex: none;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid var(--vp-c-divider, #e2e2e3);
    border-radius: 8px;
    background: transparent;
    color: var(--vp-c-text-2, #4b5563);
    font-family: inherit;
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
}

.local-ai-close:hover {
    color: var(--vp-c-text-1, #1f2328);
    background: var(--vp-c-bg-soft, #f6f6f7);
}

.local-ai-form {
    display: flex;
    gap: 8px;
}

.local-ai-input {
    flex: 1;
    min-width: 0;
    padding: 9px 12px;
    border: 1px solid var(--vp-c-divider, #e2e2e3);
    border-radius: 9px;
    background: var(--vp-c-bg-alt, #f6f6f7);
    color: var(--vp-c-text-1, #1f2328);
    font-family: inherit;
    font-size: 14px;
    line-height: 1.5;
}

.local-ai-input::placeholder {
    color: var(--vp-c-text-3, #8b949e);
}

.local-ai-submit {
    flex: none;
    padding: 9px 18px;
    border: 1px solid var(--vp-c-brand-1, #0078d4);
    border-radius: 9px;
    background: var(--vp-c-brand-1, #0078d4);
    color: #fff;
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.5;
    cursor: pointer;
}

.local-ai-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.local-ai-cancel {
    flex: none;
    padding: 9px 14px;
    border: 1px solid var(--vp-c-divider, #e2e2e3);
    border-radius: 9px;
    background: transparent;
    color: var(--vp-c-text-2, #4b5563);
    font-family: inherit;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.5;
    cursor: pointer;
}

.local-ai-cancel:hover {
    border-color: var(--vp-c-text-3, #8b949e);
    color: var(--vp-c-text-1, #1f2328);
}

.local-ai-note {
    margin: 10px 0 0;
    color: var(--vp-c-text-2, #4b5563);
    font-family: inherit;
    font-size: 11px;
    line-height: 1.55;
}

.local-ai-results {
    min-height: 0;
    margin-top: 16px;
    overflow-y: auto;
}

.local-ai-status {
    margin: 0;
    padding: 12px 14px;
    border: 1px solid var(--vp-c-divider, #e2e2e3);
    border-radius: 9px;
    background: var(--vp-c-bg-soft, #f6f6f7);
    color: var(--vp-c-text-2, #4b5563);
    font-family: inherit;
    font-size: 13px;
    line-height: 1.6;
}

.local-ai-error {
    border-color: var(--vp-c-danger-1, #d33);
    color: var(--vp-c-danger-1, #d33);
}

.local-ai-answer {
    padding: 13px 15px;
    border-left: 3px solid var(--vp-c-brand-1, #0078d4);
    border-radius: 0 9px 9px 0;
    background: var(--vp-c-bg-soft, #f6f6f7);
    color: var(--vp-c-text-1, #1f2328);
    font-family: inherit;
    font-size: 14px;
    line-height: 1.7;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.local-ai-sources {
    margin-top: 16px;
}

.local-ai-sources-title {
    margin: 0 0 8px;
    border: 0;
    color: var(--vp-c-text-2, #4b5563);
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}

.local-ai-source-list {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
}

.local-ai-source {
    display: block;
    padding: 9px 11px;
    border: 1px solid var(--vp-c-divider, #e2e2e3);
    border-radius: 8px;
    color: var(--vp-c-text-1, #1f2328);
    text-decoration: none;
    transition: border-color 0.2s, background-color 0.2s;
}

.local-ai-source:hover {
    border-color: var(--vp-c-brand-1, #0078d4);
    background: var(--vp-c-bg-soft, #f6f6f7);
}

.local-ai-source-title {
    display: block;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.5;
}

.local-ai-source-heading {
    display: block;
    margin-top: 1px;
    color: var(--vp-c-text-2, #4b5563);
    font-family: inherit;
    font-size: 12px;
    line-height: 1.5;
}

.local-ai-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}

@media (max-width: 640px) {
    .local-ai-trigger {
        right: 16px;
        bottom: 76px;
    }

    .local-ai-overlay {
        padding: 12px;
    }

    .local-ai-dialog {
        max-height: calc(100dvh - 24px);
        padding: 16px;
        border-radius: 11px;
    }

    .local-ai-form {
        flex-direction: column;
    }

    .local-ai-submit {
        width: 100%;
    }

    .local-ai-cancel {
        width: 100%;
    }
}
</style>
