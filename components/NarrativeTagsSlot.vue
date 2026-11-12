<script setup lang="ts">
import { NarrativeTagsSlotMessages } from '../i18n/NarrativeTagsSlot'

import { computed, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue'
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
  createNarrativeTagSourceProjection,
  getNarrativeTagsTargetConfig,
  makePredefinedTagValue,
  narrativeTagSourceKey,
  narrativeTagSourceLabel,
  normalizeNarrativeTagKey,
  normalizeNarrativeTagsConfig,
  parseNarrativeTagSourceProjection,
  resolveNarrativeTagsEntityTarget,
  tagValueKey
} from './narrative-tags'
import type { NarrativeTagDefinitionWithSource, NarrativeTagSource, NarrativeTagSourceConfig, NarrativeTagSourceProjection, NarrativeTagSuggestion, NarrativeTagValue } from './narrative-tags'
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
  lifecycle: { kind: 'absent' } | { kind: 'live'; worker: Worker } | { kind: 'failed' }
  requestId: number
  listeners: Set<(message: WorkerMessage) => void>
}

const getSharedWorkerState = (): SharedWorkerState => {
  const globalScope = globalThis as typeof globalThis & {
    [SHARED_WORKER_STATE_KEY]?: SharedWorkerState
  }

  if (!globalScope[SHARED_WORKER_STATE_KEY]) {
    globalScope[SHARED_WORKER_STATE_KEY] = {
      lifecycle: { kind: 'absent' },
      requestId: 1,
      listeners: new Set()
    }
  }

  return globalScope[SHARED_WORKER_STATE_KEY]
}

const getSharedWorker = () => {
  const state = getSharedWorkerState()
  if (state.lifecycle.kind !== 'live') {
    const worker = new Worker('/extensions/gcs-narrative-tags/client/worker.js', { type: 'module' })
    state.lifecycle = { kind: 'live', worker }
    worker.addEventListener('message', event => {
      const message = event.data as WorkerMessage
      for (const listener of state.listeners) {
        listener(message)
      }
    })
    const handleWorkerFailure = () => {
      if (state.lifecycle.kind !== 'live' || state.lifecycle.worker !== worker) return
      state.lifecycle = { kind: 'failed' }
      worker.terminate()
      for (const listener of state.listeners) {
        listener({ kind: 'error' })
      }
    }
    worker.addEventListener('error', handleWorkerFailure)
    worker.addEventListener('messageerror', handleWorkerFailure)
  }

  return state.lifecycle.worker
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

const { locale, t: text } = useExtensionI18n(NarrativeTagsSlotMessages)
const tagControlLabelId = useId()
const api = useExtensionApi('gcs-narrative-tags')

const normalizedConfig = computed(() => normalizeNarrativeTagsConfig(config))
const entityTarget = computed(() => resolveNarrativeTagsEntityTarget(context as Record<string, unknown>))
const sourceConfigs: Ref<NarrativeTagSourceConfig[]> = ref([])
const sourceProjection: Ref<NarrativeTagSourceProjection | null> = ref(null)
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
const findTagDefinition = (key: string, source?: NarrativeTagSource) => {
  const definition = tagByKey.value.get(sourcedTagKey(key, source))
  if (definition || (source && entityTarget.value?.targetKey !== 'agreement.description')) {
    return definition
  }

  return availableTagDefinitions.value.find(tag => tag.key === key)
}
type PersistedLoadState =
  | { kind: 'idle' | 'disposed'; tags: NarrativeTagValue[] }
  | { kind: 'success'; subject: string; tags: NarrativeTagValue[] }
  | { kind: 'error'; subject: string; baseline: 'missing' | 'accepted'; tags: NarrativeTagValue[] }
  | { kind: 'pending'; subject: string; baseline: 'missing' | 'accepted'; request: object; tags: NarrativeTagValue[] }
type RetainedTagDraft = {
  subject: string
  tags: NarrativeTagValue[]
  sources: NarrativeTagSourceConfig[]
  projection: NarrativeTagSourceProjection | null
}
type FieldTagPayload = Record<string, unknown> & { [acceptedDraftKey]?: RetainedTagDraft }
const persistedLoadState = shallowRef<PersistedLoadState>({ kind: 'idle', tags: [] })
/**
 * Checks whether the current owner has an accepted replacement baseline.
 * @param state - Current hydration state.
 * @returns Whether replacement payloads can use the selected tags.
 */
const hasPersistedBaseline = (state: PersistedLoadState) => state.kind === 'success'
  || ('baseline' in state && state.baseline === 'accepted')
const selectedTags = computed<NarrativeTagValue[]>({
  get: () => persistedLoadState.value.tags,
  set: tags => {
    const state = persistedLoadState.value
    if (state.kind === 'disposed') return
    persistedLoadState.value = { ...state, tags }
    syncTagsToAgreementPayload()
    if (state.kind === 'error' && state.baseline === 'missing') void loadPersistedTags()
  }
})
type SuggestionState = (
  | { kind: 'idle' | 'disposed'; suggestions: NarrativeTagSuggestion[] }
  | { kind: 'debouncing'; timer: ReturnType<typeof setTimeout>; requestId: number; suggestions: NarrativeTagSuggestion[] }
  | { kind: 'pending'; requestId: number; suggestions: NarrativeTagSuggestion[] }
  | { kind: 'success' | 'unavailable'; suggestions: NarrativeTagSuggestion[] }
) & { subject: string }
const suggestionState = shallowRef<SuggestionState>({ kind: 'idle', subject: '', suggestions: [] })
const suggestions = computed(() => suggestionState.value.suggestions)
const isLoading = computed(() => suggestionState.value.kind === 'debouncing' || suggestionState.value.kind === 'pending')
const suggestionsUnavailable = computed(() => suggestionState.value.kind === 'unavailable' || persistedLoadState.value.kind === 'error')

const shouldRender = computed(() =>
  normalizedConfig.value.enabled
  && Boolean(entityTarget.value)
  && Boolean(entityTarget.value?.text)
  && targetConfig.value?.enabled === true
  && availableTagDefinitions.value.length > 0
)

const sourceLabel = (source?: NarrativeTagSource) => narrativeTagSourceLabel(source, activeLocale.value)

const displayTagLabel = (tag: NarrativeTagValue) => {
  const label = tag.predefined
    ? findTagDefinition(tag.key, tag.source)?.label[activeLocale.value] ?? tag.label
    : tag.label
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
const tagInputValue = (tag: NarrativeTagValue) => tag.source ? tagValueKey(tag) : displayTagLabel(tag)
const selectedTagByInputValue = computed(() => new Map(selectedTags.value.map(tag => [tagInputValue(tag), tag])))
const tagInputLabels = computed(() => selectedTags.value.map(tagInputValue))
const inputTagLabel = (value: string) => {
  const tag = selectedTagByInputValue.value.get(value)
  return tag ? displayTagLabel(tag) : value
}
const isPredefinedTagLabel = (value: string) => selectedTagByInputValue.value.get(value)?.predefined
  ?? predefinedTagByInputLabel.value.has(normalizeInputTagLabel(value).toLowerCase())
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
 * Loads persisted field tags and source configs, using embedded payload tags for unsaved targets.
 */
const loadPersistedTags = async () => {
  if (persistedLoadState.value.kind === 'disposed') return
  const url = routeUrl.value
  const storageKey = fieldStorageKey.value
  const target = entityTarget.value
  const subject = JSON.stringify([target?.targetKey, target?.ownerId, target?.streamId,
    context && 'agencies' in context ? context.agencies : null])
  const extensionPayload = target?.extensions['gcs-narrative-tags']
  const fieldTags: FieldTagPayload = extensionPayload?.textFieldTags && typeof extensionPayload.textFieldTags === 'object'
    ? extensionPayload.textFieldTags as Record<string, unknown>
    : {}
  const retained = fieldTags[acceptedDraftKey]
  const retainedDraft = retained?.subject === subject ? retained : undefined
  const previous = persistedLoadState.value
  const sameSubject = 'subject' in previous && previous.subject === subject
  const baseline = (sameSubject && hasPersistedBaseline(previous)) || retainedDraft ? 'accepted' : 'missing'
  const request = {}
  persistedLoadState.value = { kind: 'pending', subject, baseline, request, tags: sameSubject ? previous.tags : retainedDraft?.tags ?? [] }
  if (retainedDraft && !sameSubject) {
    sourceConfigs.value = retainedDraft.sources
    sourceProjection.value = retainedDraft.projection
  }
  if (baseline === 'missing') {
    sourceConfigs.value = []
    sourceProjection.value = null
    if (target?.targetKey === 'proponent.description') {
      target.setExtensionPayload?.('gcs-narrative-tags', 'proponentSourceProjection', null)
    }
  }
  if (!url) {
    if (!target || target.ownerId) {
      persistedLoadState.value = { kind: 'error', subject, baseline: 'missing', tags: [] }
      return
    }
    sourceConfigs.value = []
    persistedLoadState.value = {
      kind: 'success',
      subject,
      tags: resolveEmbeddedNarrativeTags(entityTarget.value, fieldStorageKey.value, key => Boolean(findTagDefinition(key)))
    }
    syncTagsToAgreementPayload()
    return
  }

  try {
    type TagsResponse = {
      tags: NarrativeTagValue[]
      textFieldTags?: Record<string, NarrativeTagValue[]>
      sources?: NarrativeTagSourceConfig[]
      sourceProjection?: unknown
    }
    const proponentAgencies = context && 'agencies' in context && Array.isArray(context.agencies)
      ? context.agencies.filter((agency): agency is { agencyId: string } =>
          typeof agency === 'object' && agency !== null && 'agencyId' in agency && typeof agency.agencyId === 'string')
      : []
    const urls = target?.targetKey === 'proponent.description' && proponentAgencies.length > 0
      ? proponentAgencies.map(agency => `/agencies/${encodeURIComponent(agency.agencyId)}/applicant-recipients/${encodeURIComponent(target.ownerId ?? '')}/tags`)
      : [url]
    const responses = await Promise.all(urls.map(url => api.get<TagsResponse>(url)))
    const state = persistedLoadState.value
    if (state.kind !== 'pending' || state.request !== request) return
    const nextSourceConfigs = normalizeNarrativeTagsSourceConfigs(responses.flatMap(response => response.sources ?? []))
    if (target?.targetKey === 'proponent.description') {
      for (const response of responses) {
        const projection = parseNarrativeTagSourceProjection(response.sourceProjection)
        if (!projection || JSON.stringify(projection) !== JSON.stringify(createNarrativeTagSourceProjection(response.sources ?? []))) {
          throw new Error('Narrative tag source projection is unavailable.')
        }
      }
      if (baseline === 'missing') sourceProjection.value = createNarrativeTagSourceProjection(nextSourceConfigs)
    }
    sourceConfigs.value = nextSourceConfigs
    const savedTags = responses.flatMap(response => resolveFetchedNarrativeTags(response, storageKey, findTagDefinition))
    persistedLoadState.value = {
      kind: 'success',
      subject,
      tags: baseline === 'accepted' ? state.tags : [...new Map([...savedTags, ...state.tags].map(tag => [tagValueKey(tag), tag])).values()]
    }
    syncTagsToAgreementPayload()
  } catch {
    const state = persistedLoadState.value
    if (state.kind !== 'pending' || state.request !== request) return
    persistedLoadState.value = { kind: 'error', subject, baseline: state.baseline, tags: state.tags }
    syncTagsToAgreementPayload()
  }
}

/**
 * Applies only the latest worker response and substitutes keyword suggestions when worker scoring fails.
 */
const handleWorkerMessage = (message: WorkerMessage) => {
  const state = suggestionState.value
  if (state.kind !== 'pending') return
  const isSharedWorkerFailure = message.kind === 'error' && message.requestId === undefined
  if (!isSharedWorkerFailure && message.requestId !== state.requestId) {
    return
  }

  if (message.kind === 'error') {
    const target = entityTarget.value
    suggestionState.value = {
      kind: 'unavailable',
      subject: state.subject,
      suggestions: target
        ? resolveKeywordFallbackSuggestions(target.text, availableTagDefinitions.value, targetConfig.value)
        : []
    }
    return
  }

  suggestionState.value = {
    kind: 'success',
    subject: state.subject,
    suggestions: resolveNarrativeTagsWorkerSuggestions(
      message.suggestions ?? [], targetConfig.value, key => findTagDefinition(key)
    )
  }
}

const clearPendingTimer = () => {
  if (suggestionState.value.kind === 'debouncing') clearTimeout(suggestionState.value.timer)
}

/**
 * Uses immediate keyword ranking for sourced proponent tags or debounces a worker request for other targets.
 */
const scheduleSuggestions = () => {
  if (suggestionState.value.kind === 'disposed') return
  clearPendingTimer()
  const target = entityTarget.value
  const targetText = target?.text ?? ''
  const configForTarget = targetConfig.value
  const subject = `${routeUrl.value ?? ''}:${fieldStorageKey.value}`
  const retainedSuggestions = suggestionState.value.subject === subject ? suggestions.value : []
  if (!shouldRender.value || !targetText) {
    suggestionState.value = { kind: 'idle', subject, suggestions: [] }
    return
  }

  if (target?.targetKey === 'proponent.description' && sourceConfigs.value.length > 0) {
    suggestionState.value = {
      kind: 'success',
      subject,
      suggestions: resolveKeywordFallbackSuggestions(targetText, availableTagDefinitions.value, configForTarget)
    }
    return
  }

  const requestId = createSharedRequestId()
  const payload = buildNarrativeTagsWorkerPayload(targetText, activeLocale.value, configForTarget, availableTagDefinitions.value)
  const timer = setTimeout(() => {
    if (suggestionState.value.kind !== 'debouncing' || suggestionState.value.requestId !== requestId) return
    suggestionState.value = { kind: 'pending', subject, requestId, suggestions: suggestionState.value.suggestions }
    try {
      getSharedWorker().postMessage({
        type: 'suggest',
        requestId,
        payload
      })
    } catch {
      suggestionState.value = {
        kind: 'unavailable',
        subject,
        suggestions: resolveKeywordFallbackSuggestions(targetText, availableTagDefinitions.value, configForTarget)
      }
    }
  }, SCORE_REQUEST_DEBOUNCE_MS)
  suggestionState.value = { kind: 'debouncing', subject, timer, requestId, suggestions: retainedSuggestions }
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

    const inputLabel = normalizedLabel.toLowerCase()
    const nextTag = selectedTagByInputValue.value.get(label) ?? predefinedTagByInputLabel.value.get(inputLabel) ?? {
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
  if (!hasPersistedBaseline(persistedLoadState.value) || !target?.setExtensionPayload || !fieldStorageKey.value) {
    return
  }

  if (target.targetKey === 'proponent.description') {
    if (!sourceProjection.value) return
    target.setExtensionPayload('gcs-narrative-tags', 'proponentSourceProjection', sourceProjection.value)
  }

  const extensionPayload = target.extensions['gcs-narrative-tags'] ?? {}
  const currentTextFieldTags: FieldTagPayload = extensionPayload.textFieldTags && typeof extensionPayload.textFieldTags === 'object'
    ? extensionPayload.textFieldTags as Record<string, unknown>
    : {}

  const nextTextFieldTags: FieldTagPayload = {
    ...currentTextFieldTags,
    [fieldStorageKey.value]: selectedTags.value
  }
  if (target.targetKey === 'proponent.description' && 'subject' in persistedLoadState.value) {
    Object.defineProperty(nextTextFieldTags, acceptedDraftKey, {
      configurable: true,
      value: {
        subject: persistedLoadState.value.subject,
        tags: selectedTags.value,
        sources: sourceConfigs.value,
        projection: sourceProjection.value
      } satisfies RetainedTagDraft
    })
  }
  target.setExtensionPayload('gcs-narrative-tags', 'textFieldTags', nextTextFieldTags)

  if (target.targetKey === 'agreement.description') {
    target.setExtensionPayload('gcs-narrative-tags', 'agreementDescriptionTags', selectedTags.value)
  }
}

const unsubscribeWorker = subscribeToSharedWorker(handleWorkerMessage)

watch([
  routeUrl,
  fieldStorageKey,
  () => context && 'agencies' in context ? JSON.stringify(context.agencies) : '',
  () => normalizedConfig.value.tags.map(tag => tag.key).join('|')
], () => {
  void loadPersistedTags()
}, { immediate: true, flush: 'sync' })

watch(() => ({
  identity: routeUrl.value,
  ...buildNarrativeTagsSuggestionWatchState(
    entityTarget.value,
    activeLocale.value,
    availableTagDefinitions.value,
    normalizedConfig.value.enabled,
    targetConfig.value
  )
}), scheduleSuggestions, { immediate: true, deep: true, flush: 'sync' })

onBeforeUnmount(() => {
  clearPendingTimer()
  suggestionState.value = { kind: 'disposed', subject: suggestionState.value.subject, suggestions: [] }
  persistedLoadState.value = { kind: 'disposed', tags: [] }
  unsubscribeWorker()
})
</script>

<script lang="ts">
// The controlled payload retains this in-memory evidence; JSON cannot supply or serialize it.
const acceptedDraftKey = Symbol('accepted-narrative-tag-draft')
</script>

<template>
  <div v-if="shouldRender" class="space-y-3" data-field-scope="extension.gcs-narrative-tags.narrative-tags-slot">
    <div class="flex flex-wrap items-center gap-2">
      <span :id="tagControlLabelId" class="text-sm font-medium text-zinc-900 dark:text-white">
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
      <ExtensionBadge v-if="suggestionsUnavailable" color="warning" variant="subtle">
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
        :aria-labelledby="tagControlLabelId"
        multiple
        label-key="label"
        :items="predefinedOptions"
        :placeholder="text('select')"
        class="w-full" data-ui-target="extension.gcs-narrative-tags.narrative-tags-slot.selected-tags">
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
          :aria-labelledby="tagControlLabelId"
          :model-value="tagInputLabels"
          :add-on-blur="true"
          :placeholder="text('customPlaceholder')"
          class="agreement-tag-input w-full" data-ui-target="extension.gcs-narrative-tags.narrative-tags-slot.custom-tags"
          @update:model-value="updateTagInputValues">
          <template #item-text="{ item }">
            <span
              :class="isPredefinedTagLabel(String(item)) ? 'agreement-tag-input__predefined' : 'agreement-tag-input__custom'">
              {{ inputTagLabel(String(item)) }}
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
