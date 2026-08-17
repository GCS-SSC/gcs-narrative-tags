<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { GcsExtensionJsonConfig, GcsExtensionSlotContext } from '@gcs-ssc/extensions'
import {
  ExtensionBadge,
  ExtensionButton,
  ExtensionInputTags,
  ExtensionSelectMenu,
  useExtensionApi,
  useExtensionI18n
} from '@gcs-ssc/extensions/ui'
import {
  getNarrativeTagsTargetConfig,
  makePredefinedTagValue,
  narrativeTagSourceKey,
  narrativeTagSourceLabel,
  normalizeNarrativeTagKey,
  normalizeNarrativeTagsConfig,
  resolveNarrativeTagsEntityTarget,
  tagValueKey
} from './narrative-tags'
import type { NarrativeTagDefinitionWithSource, NarrativeTagSource, NarrativeTagSourceConfig, NarrativeTagSuggestion, NarrativeTagValue } from './narrative-tags'
import {
  buildNarrativeTagsWorkerPayload,
  buildNarrativeTagsSuggestionWatchState,
  normalizeNarrativeTagsSourceConfigs,
  resolveEmbeddedNarrativeTags,
  resolveFetchedNarrativeTags,
  resolveKeywordFallbackSuggestions,
  resolveNarrativeTagsRouteUrl,
  resolveNarrativeTagsWorkerSuggestions
} from './narrative-tags-slot-helpers'

interface WorkerMessage {
  kind?: 'result' | 'error'
  requestId?: number
  suggestions?: NarrativeTagSuggestion[]
  error?: string
}

const SCORE_REQUEST_DEBOUNCE_MS = 500
const SHARED_WORKER_STATE_KEY = '__gcsNarrativeTagsWorkerState'

interface SharedWorkerState {
  worker: Worker | null
  requestId: number
  listeners: Set<(message: WorkerMessage) => void>
}

const getSharedWorkerState = (): SharedWorkerState => {
  const globalScope = globalThis as typeof globalThis & {
    [SHARED_WORKER_STATE_KEY]?: SharedWorkerState
  }

  if (!globalScope[SHARED_WORKER_STATE_KEY]) {
    globalScope[SHARED_WORKER_STATE_KEY] = {
      worker: null,
      requestId: 1,
      listeners: new Set()
    }
  }

  return globalScope[SHARED_WORKER_STATE_KEY]
}

const getSharedWorker = () => {
  const state = getSharedWorkerState()
  if (!state.worker) {
    const worker = new Worker('/extensions/gcs-narrative-tags/client/worker.js', { type: 'module' })
    state.worker = worker
    worker.addEventListener('message', event => {
      const message = event.data as WorkerMessage
      for (const listener of state.listeners) {
        listener(message)
      }
    })
    const handleWorkerFailure = () => {
      if (state.worker !== worker) return
      state.worker = null
      worker.terminate()
      for (const listener of state.listeners) {
        listener({ kind: 'error' })
      }
    }
    worker.addEventListener('error', handleWorkerFailure)
    worker.addEventListener('messageerror', handleWorkerFailure)
  }

  return state.worker
}

const subscribeToSharedWorker = (listener: (message: WorkerMessage) => void) => {
  const state = getSharedWorkerState()
  state.listeners.add(listener)

  return () => {
    state.listeners.delete(listener)
  }
}

const createSharedRequestId = () => {
  const state = getSharedWorkerState()
  const requestId = state.requestId
  state.requestId += 1
  return requestId
}

const {
  config,
  context = {}
} = defineProps<{
  config: GcsExtensionJsonConfig
  context?: GcsExtensionSlotContext
}>()

const { locale } = useExtensionI18n()
const api = useExtensionApi('gcs-narrative-tags')

const normalizedConfig = computed(() => normalizeNarrativeTagsConfig(config))
const entityTarget = computed(() => resolveNarrativeTagsEntityTarget(context as Record<string, unknown>))
const sourceConfigs: Ref<NarrativeTagSourceConfig[]> = ref([])
const targetConfig = computed(() => {
  const target = entityTarget.value
  if (!target) {
    return null
  }

  if (target.targetKey === 'proponent.description' && sourceConfigs.value.length > 0) {
    const configs = sourceConfigs.value.map(item => getNarrativeTagsTargetConfig(item.config, target.targetKey))
    const firstConfig = configs[0]
    return {
      ...firstConfig,
      enabled: configs.some(item => item.enabled),
      allowCustomTags: configs.some(item => item.allowCustomTags),
      allowDynamicTagSuggestions: configs.some(item => item.allowDynamicTagSuggestions),
      minScore: Math.min(...configs.map(item => item.minScore)),
      maxSuggestions: Math.max(...configs.map(item => item.maxSuggestions)),
      minDynamicScore: Math.min(...configs.map(item => item.minDynamicScore)),
      maxDynamicTags: Math.max(...configs.map(item => item.maxDynamicTags))
    }
  }

  return getNarrativeTagsTargetConfig(normalizedConfig.value, target.targetKey)
})
const activeLocale = computed(() => locale.value === 'fr' ? 'fr' : 'en')
const availableTagDefinitions = computed<NarrativeTagDefinitionWithSource[]>(() => {
  const target = entityTarget.value
  if (target?.targetKey === 'proponent.description' && sourceConfigs.value.length > 0) {
    return sourceConfigs.value.flatMap(sourceConfig => {
      const configForTarget = getNarrativeTagsTargetConfig(sourceConfig.config, target.targetKey)
      if (!sourceConfig.config.enabled || !configForTarget.enabled) {
        return []
      }

      return sourceConfig.config.tags.map(tag => ({
        ...tag,
        source: sourceConfig.source
      }))
    })
  }

  return normalizedConfig.value.tags
})
const sourcedTagKey = (key: string, source?: NarrativeTagSource) => `${narrativeTagSourceKey(source)}:${key}`
const tagByKey = computed(() => new Map(availableTagDefinitions.value.map(tag => [sourcedTagKey(tag.key, tag.source), tag])))
const findTagDefinition = (key: string, source?: NarrativeTagSource) =>
  tagByKey.value.get(sourcedTagKey(key, source))
  ?? availableTagDefinitions.value.find(tag => tag.key === key)
const selectedTags: Ref<NarrativeTagValue[]> = ref([])
const suggestions: Ref<NarrativeTagSuggestion[]> = ref([])
const isLoading: Ref<boolean> = ref(false)
const error: Ref<string> = ref('')
const latestRequestId: Ref<number> = ref(0)
const pendingTimer: Ref<ReturnType<typeof setTimeout> | null> = ref(null)
const unsubscribeWorker: Ref<(() => void) | null> = ref(null)

const labels = {
  title: { en: 'Suggested tags', fr: 'Étiquettes suggérées' },
  unavailable: { en: 'Tag suggestions unavailable', fr: 'Suggestions d’étiquettes indisponibles' },
  select: { en: 'Select tags', fr: 'Sélectionner les étiquettes' },
  customPlaceholder: { en: 'Add custom tags', fr: 'Ajouter des étiquettes personnalisées' },
  noAgreement: { en: 'Save this record to persist tags.', fr: 'Enregistrez cet enregistrement pour conserver les étiquettes.' }
} as const

const text = (key: keyof typeof labels) => {
  const item = labels[key]
  return locale.value === 'fr' ? item.fr : item.en
}

const shouldRender = computed(() =>
  normalizedConfig.value.enabled
  && Boolean(entityTarget.value)
  && targetConfig.value?.enabled === true
  && availableTagDefinitions.value.length > 0
)

const sourceLabel = (source?: NarrativeTagSource) => narrativeTagSourceLabel(source, activeLocale.value)

const displayTagLabel = (tag: NarrativeTagValue) => {
  const label = tag.label
  const source = sourceLabel(tag.source)
  return source ? `${label} - ${source}` : label
}

const predefinedOptions = computed<NarrativeTagValue[]>(() => availableTagDefinitions.value.map(tag => makePredefinedTagValue(tag, activeLocale.value, tag.source)))

const suggestionLabel = (suggestion: NarrativeTagSuggestion) =>
  suggestion.predefined === false
    ? displayTagLabel({ predefined: false, label: suggestion.label, source: suggestion.source })
    : (() => {
        const tag = findTagDefinition(suggestion.key, suggestion.source)
        return tag ? displayTagLabel(makePredefinedTagValue(tag, activeLocale.value, tag.source)) : suggestion.key
      })()

const normalizeInputTagLabel = (value: string) => value.trim().replace(/\s+/g, ' ')

const predefinedTagByInputLabel = computed(() => {
  const items = new Map<string, NarrativeTagValue>()
  for (const tag of availableTagDefinitions.value) {
    const predefinedTag = makePredefinedTagValue(tag, activeLocale.value, tag.source)
    items.set(normalizeInputTagLabel(predefinedTag.label).toLowerCase(), predefinedTag)
    items.set(normalizeInputTagLabel(displayTagLabel(predefinedTag)).toLowerCase(), predefinedTag)
  }

  return items
})

const selectedPredefinedTagKeys = computed(() => new Set(
  selectedTags.value.flatMap(tag => tag.predefined ? [tagValueKey(tag)] : [])
))
const suggestionItems = computed(() => suggestions.value.filter(item =>
  item.predefined === false
    ? targetConfig.value?.allowCustomTags === true && !selectedTags.value.some(tag => !tag.predefined && normalizeNarrativeTagKey(tag.label) === normalizeNarrativeTagKey(item.label))
    : Boolean(findTagDefinition(item.key, item.source)) && !selectedPredefinedTagKeys.value.has(tagValueKey(makePredefinedTagValue(findTagDefinition(item.key, item.source)!, activeLocale.value, item.source)))
))
const tagInputLabels = computed(() => selectedTags.value.map(tag => displayTagLabel(tag)))
const isPredefinedTagLabel = (label: string) => predefinedTagByInputLabel.value.has(normalizeInputTagLabel(label).toLowerCase())
const defaultCustomSource = computed(() => {
  const target = entityTarget.value
  if (target?.targetKey !== 'proponent.description') {
    return undefined
  }

  return sourceConfigs.value.find(item => getNarrativeTagsTargetConfig(item.config, target.targetKey).allowCustomTags)?.source
    ?? sourceConfigs.value[0]?.source
})

const routeUrl = computed(() => {
  return resolveNarrativeTagsRouteUrl(entityTarget.value)
})

const fieldStorageKey = computed(() => {
  const target = entityTarget.value
  return target ? target.targetKey : ''
})

/**
 * Loads persisted field tags and source configs, using embedded payload tags when no route can be formed.
 */
const loadPersistedTags = async () => {
  if (!routeUrl.value) {
    sourceConfigs.value = []
    selectedTags.value = resolveEmbeddedNarrativeTags(
      entityTarget.value,
      fieldStorageKey.value,
      key => tagByKey.value.has(key)
    )
    error.value = ''
    return
  }

  try {
    const response = await api.get<{
      tags: NarrativeTagValue[]
      textFieldTags?: Record<string, NarrativeTagValue[]>
      sources?: NarrativeTagSourceConfig[]
    }>(routeUrl.value)
    sourceConfigs.value = normalizeNarrativeTagsSourceConfigs(response.sources)
    selectedTags.value = resolveFetchedNarrativeTags(response, fieldStorageKey.value, findTagDefinition)
  } catch {
    selectedTags.value = []
    error.value = text('unavailable')
  }
}

/**
 * Applies only the latest worker response and substitutes keyword suggestions when worker scoring fails.
 */
const handleWorkerMessage = (message: WorkerMessage) => {
  const isSharedWorkerFailure = message.kind === 'error' && message.requestId === undefined
  if (!isSharedWorkerFailure && message.requestId !== latestRequestId.value) {
    return
  }

  isLoading.value = false
  if (message.kind === 'error') {
    error.value = text('unavailable')
    const target = entityTarget.value
    suggestions.value = target
      ? resolveKeywordFallbackSuggestions(target.text, availableTagDefinitions.value, targetConfig.value)
      : []
    return
  }

  suggestions.value = resolveNarrativeTagsWorkerSuggestions(
    message.suggestions ?? [],
    targetConfig.value,
    key => findTagDefinition(key)
  )
  error.value = ''
}

const clearPendingTimer = () => {
  if (pendingTimer.value) {
    clearTimeout(pendingTimer.value)
    pendingTimer.value = null
  }
}

/**
 * Uses immediate keyword ranking for sourced proponent tags or debounces a worker request for other targets.
 */
const scheduleSuggestions = () => {
  clearPendingTimer()
  const target = entityTarget.value
  const targetText = target?.text ?? ''
  const configForTarget = targetConfig.value
  if (!shouldRender.value || !targetText) {
    suggestions.value = []
    isLoading.value = false
    return
  }

  if (target?.targetKey === 'proponent.description' && sourceConfigs.value.length > 0) {
    suggestions.value = resolveKeywordFallbackSuggestions(targetText, availableTagDefinitions.value, configForTarget)
    isLoading.value = false
    error.value = ''
    return
  }

  isLoading.value = true
  error.value = ''
  const requestId = createSharedRequestId()
  latestRequestId.value = requestId
  pendingTimer.value = setTimeout(() => {
    pendingTimer.value = null
    try {
      getSharedWorker().postMessage({
        type: 'suggest',
        requestId,
        payload: buildNarrativeTagsWorkerPayload(targetText, activeLocale.value, configForTarget, availableTagDefinitions.value)
      })
    } catch {
      isLoading.value = false
      error.value = text('unavailable')
      suggestions.value = resolveKeywordFallbackSuggestions(targetText, availableTagDefinitions.value, configForTarget)
    }
  }, SCORE_REQUEST_DEBOUNCE_MS)
}

const addSuggestion = (key: string, source?: NarrativeTagSource) => {
  const tag = findTagDefinition(key, source)
  if (!tag) {
    return
  }

  const nextTag = makePredefinedTagValue(tag, activeLocale.value, tag.source)
  if (selectedTags.value.some(item => tagValueKey(item) === tagValueKey(nextTag))) {
    return
  }

  selectedTags.value = [...selectedTags.value, nextTag]
}

const addDynamicSuggestion = (label: string) => {
  if (targetConfig.value?.allowCustomTags !== true) {
    return
  }

  const nextTag: NarrativeTagValue = {
    predefined: false,
    label: normalizeInputTagLabel(label),
    source: defaultCustomSource.value
  }
  if (!nextTag.label || selectedTags.value.some(item => tagValueKey(item) === tagValueKey(nextTag))) {
    return
  }

  selectedTags.value = [...selectedTags.value, nextTag]
}

const addSuggestedTag = (suggestion: NarrativeTagSuggestion) => {
  if (suggestion.predefined === false) {
    addDynamicSuggestion(suggestion.label)
    return
  }

  addSuggestion(suggestion.key, suggestion.source)
}

/**
 * Rebuilds selected tags from normalized labels, resolving known labels and removing duplicate values.
 */
const updateTagInputValues = (labels: string[]) => {
  const seenKeys = new Set<string>()
  const nextTags = labels.flatMap(label => {
    const normalizedLabel = normalizeInputTagLabel(label)
    if (!normalizedLabel) {
      return []
    }

    const predefinedTag = predefinedTagByInputLabel.value.get(normalizedLabel.toLowerCase())
    const nextTag = predefinedTag ?? {
      predefined: false as const,
      label: normalizedLabel,
      source: defaultCustomSource.value
    }
    const key = tagValueKey(nextTag)
    if (seenKeys.has(key)) {
      return []
    }

    seenKeys.add(key)
    return [nextTag]
  })

  selectedTags.value = nextTags
}

/**
 * Writes field-scoped tags to the host payload and mirrors agreement tags to the legacy payload key.
 */
const syncTagsToAgreementPayload = () => {
  const target = entityTarget.value
  if (!target?.setExtensionPayload || !fieldStorageKey.value) {
    return
  }

  const extensionPayload = target.extensions['gcs-narrative-tags'] ?? {}
  const currentTextFieldTags = extensionPayload.textFieldTags && typeof extensionPayload.textFieldTags === 'object'
    ? extensionPayload.textFieldTags as Record<string, unknown>
    : {}

  target.setExtensionPayload('gcs-narrative-tags', 'textFieldTags', {
    ...currentTextFieldTags,
    [fieldStorageKey.value]: selectedTags.value
  })

  if (target.targetKey === 'agreement.description') {
    target.setExtensionPayload('gcs-narrative-tags', 'agreementDescriptionTags', selectedTags.value)
  }
}

unsubscribeWorker.value = subscribeToSharedWorker(handleWorkerMessage)

watch(() => [routeUrl.value, normalizedConfig.value.tags.map(tag => tag.key).join('|')], () => {
  void loadPersistedTags()
}, { immediate: true })

watch(() => buildNarrativeTagsSuggestionWatchState(
  entityTarget.value,
  activeLocale.value,
  availableTagDefinitions.value,
  normalizedConfig.value.enabled,
  targetConfig.value
), scheduleSuggestions, { immediate: true, deep: true })

watch(selectedTags, syncTagsToAgreementPayload, { deep: true })

onBeforeUnmount(() => {
  clearPendingTimer()
  if (unsubscribeWorker.value) {
    unsubscribeWorker.value()
  }
})
</script>

<template>
  <div v-if="shouldRender" class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-sm font-medium text-zinc-900 dark:text-white">
        {{ text('title') }}
      </span>
      <div
        v-if="isLoading"
        class="inline-flex items-center gap-1"
        :aria-label="text('title')"
        role="status">
        <span class="plugin-runtime-activity-dot" />
        <span class="plugin-runtime-activity-dot plugin-runtime-activity-dot--delayed" />
        <span class="plugin-runtime-activity-dot plugin-runtime-activity-dot--late" />
      </div>
      <ExtensionBadge v-if="error" color="warning" variant="subtle">
        {{ text('unavailable') }}
      </ExtensionBadge>
    </div>

    <div v-if="suggestionItems.length > 0" class="flex flex-wrap gap-2">
      <ExtensionButton
        v-for="suggestion in suggestionItems"
        :key="suggestion.predefined === false ? `${narrativeTagSourceKey(suggestion.source)}:${normalizeNarrativeTagKey(suggestion.label)}` : `${narrativeTagSourceKey(suggestion.source)}:${suggestion.key}`"
        color="neutral"
        variant="outline"
        size="sm"
        class="cursor-default"
        icon="i-lucide-plus"
        :label="suggestionLabel(suggestion)"
        @click="addSuggestedTag(suggestion)" />
    </div>

    <div class="space-y-2">
      <ExtensionSelectMenu
        v-if="targetConfig?.allowCustomTags !== true"
        v-model="selectedTags"
        multiple
        label-key="label"
        :items="predefinedOptions"
        :placeholder="text('select')"
        class="w-full">
        <template #default="{ modelValue }">
          <div v-if="Array.isArray(modelValue) && modelValue.length > 0" class="flex flex-wrap gap-1">
            <ExtensionBadge
              v-for="tag in modelValue"
              :key="tagValueKey(tag)"
              color="neutral"
              variant="subtle">
              {{ displayTagLabel(tag) }}
            </ExtensionBadge>
          </div>
        </template>
      </ExtensionSelectMenu>

      <div v-else>
        <ExtensionInputTags
          :model-value="tagInputLabels"
          :add-on-blur="true"
          :placeholder="text('customPlaceholder')"
          class="agreement-tag-input w-full"
          @update:model-value="updateTagInputValues">
          <template #item-text="{ item }">
            <span
              :class="isPredefinedTagLabel(String(item)) ? 'agreement-tag-input__predefined' : 'agreement-tag-input__custom'">
              {{ item }}
            </span>
          </template>
        </ExtensionInputTags>
      </div>
    </div>

    <p v-if="!routeUrl" class="text-xs text-zinc-500 dark:text-zinc-400">
      {{ text('noAgreement') }}
    </p>
  </div>
</template>

<style scoped>
.plugin-runtime-activity-dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 9999px;
  background: var(--ui-primary);
  animation: plugin-runtime-activity-bounce 1s infinite ease-in-out;
}

.plugin-runtime-activity-dot--delayed {
  animation-delay: -0.2s;
}

.plugin-runtime-activity-dot--late {
  animation-delay: -0.1s;
}

.agreement-tag-input :deep([data-slot="item"]:has(.agreement-tag-input__predefined)) {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-elevated);
  color: var(--ui-text);
}

.agreement-tag-input :deep([data-slot="item"]:has(.agreement-tag-input__custom)) {
  border-color: color-mix(in oklab, var(--ui-primary) 55%, transparent);
  background: color-mix(in oklab, var(--ui-primary) 18%, transparent);
  color: var(--ui-primary);
}

@keyframes plugin-runtime-activity-bounce {
  0%, 80%, 100% {
    opacity: 0.35;
    transform: translateY(0);
  }

  40% {
    opacity: 1;
    transform: translateY(-2px);
  }
}
</style>
