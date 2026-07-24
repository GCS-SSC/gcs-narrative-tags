import {
  normalizeNarrativeTagsConfig,
  narrativeTagSourceKey,
  rankTagsByKeywordOverlap,
  type NarrativeTagDefinitionWithSource,
  type NarrativeTagSourceConfig,
  type NarrativeTagSuggestion,
  type NarrativeTagValue,
  type NarrativeTagsTargetConfig,
  type NarrativeTagsEntityTarget
} from './narrative-tags'

type NarrativeTagsSlotTargetConfig = Partial<NarrativeTagsTargetConfig>
type NarrativeTagsNumericConfigKey =
  | 'minScore'
  | 'maxSuggestions'
  | 'minDynamicScore'
  | 'maxDynamicTags'
  | 'dynamicNgramMin'
  | 'dynamicNgramMax'
  | 'semanticWeight'
  | 'lexicalWeight'
  | 'exactAliasBoost'
  | 'negationPenalty'
  | 'negationWindow'

const NARRATIVE_TAGS_WORKER_NUMERIC_DEFAULTS: Record<NarrativeTagsNumericConfigKey, number> = {
  minScore: 1,
  maxSuggestions: 0,
  minDynamicScore: 1,
  maxDynamicTags: 0,
  dynamicNgramMin: 1,
  dynamicNgramMax: 1,
  semanticWeight: 0,
  lexicalWeight: 0,
  exactAliasBoost: 0,
  negationPenalty: 0,
  negationWindow: 0
}

/**
 * Builds the supported entity persistence route, returning an empty string when required identifiers are absent.
 */
export const resolveNarrativeTagsRouteUrl = (target: NarrativeTagsEntityTarget | null): string => {
  if (!target) {
    return ''
  }

  if (target.targetKey === 'agreement.description' && target.streamId && target.ownerId) {
    return `/streams/${encodeURIComponent(target.streamId)}/agreements/${encodeURIComponent(target.ownerId)}/tags`
  }

  if (target.targetKey === 'proponent.description' && target.agencyId && target.ownerId) {
    return `/agencies/${encodeURIComponent(target.agencyId)}/applicant-recipients/${encodeURIComponent(target.ownerId)}/tags`
  }

  return ''
}

/**
 * Normalizes every returned source configuration while treating a missing source list as empty.
 */
export const normalizeNarrativeTagsSourceConfigs = (
  sources: NarrativeTagSourceConfig[] | undefined
): NarrativeTagSourceConfig[] => {
  return Array.isArray(sources)
    ? sources.map(item => ({
        source: item.source,
        config: normalizeNarrativeTagsConfig(item.config)
      }))
    : []
}

/**
 * Keeps object tags that either omit a key or reference a key in the active catalog.
 */
export const filterValidPersistedNarrativeTags = (
  tags: unknown,
  hasTagKey: (key: string) => boolean
): NarrativeTagValue[] => {
  return Array.isArray(tags)
    ? tags.filter((tag): tag is NarrativeTagValue =>
        typeof tag === 'object'
        && tag !== null
        && (!('key' in tag) || hasTagKey(String(tag.key)))
      )
    : []
}

/**
 * Reads and validates the current field's tags from an entity's embedded extension payload.
 */
export const resolveEmbeddedNarrativeTags = (
  target: NarrativeTagsEntityTarget | null,
  fieldStorageKey: string,
  hasTagKey: (key: string) => boolean
): NarrativeTagValue[] => {
  const payload = target?.extensions['gcs-narrative-tags']
  const currentTextFieldTags = payload?.textFieldTags && typeof payload.textFieldTags === 'object'
    ? payload.textFieldTags as Record<string, unknown>
    : {}
  const tags = fieldStorageKey ? currentTextFieldTags[fieldStorageKey] : []

  return filterValidPersistedNarrativeTags(tags, hasTagKey)
}

/**
 * Selects field-specific fetched tags with a legacy agreement-tag fallback, then drops unavailable predefined values.
 */
export const resolveFetchedNarrativeTags = (
  response: {
    tags: NarrativeTagValue[]
    textFieldTags?: Record<string, NarrativeTagValue[]>
  },
  fieldStorageKey: string,
  findTagDefinition: (key: string, source?: NarrativeTagValue['source']) => NarrativeTagDefinitionWithSource | undefined
): NarrativeTagValue[] => {
  const tags = fieldStorageKey && response.textFieldTags
    ? response.textFieldTags[fieldStorageKey] ?? response.tags
    : response.tags

  return tags.filter(tag => !tag.predefined || Boolean(findTagDefinition(tag.key, tag.source)))
}

/**
 * Backfills predefined sources, enforces score thresholds, and caps the combined worker suggestions.
 */
export const resolveNarrativeTagsWorkerSuggestions = (
  suggestions: NarrativeTagSuggestion[],
  config: NarrativeTagsSlotTargetConfig | null,
  findTagSource: (key: string) => NarrativeTagDefinitionWithSource | undefined
): NarrativeTagSuggestion[] => {
  return suggestions
    .map(item => item.predefined === true && !item.source
      ? {
          ...item,
          source: findTagSource(item.key)?.source
        }
      : item)
    .filter(item => item.predefined === false
      ? item.score >= (config?.minDynamicScore ?? 1)
      : item.score >= (config?.minScore ?? 1))
    .slice(0, (config?.maxSuggestions ?? 0) + (config?.maxDynamicTags ?? 0))
}

const resolveNarrativeTagsWorkerConfig = (config: NarrativeTagsSlotTargetConfig | null) => {
  const resolvedConfig = config ?? {}

  return {
    ...resolveNarrativeTagsWorkerNumericConfig(resolvedConfig),
    ...resolveNarrativeTagsWorkerBooleanConfig(resolvedConfig)
  }
}

const resolveNarrativeTagsWorkerNumericConfig = (config: NarrativeTagsSlotTargetConfig) => {
  return Object.fromEntries(
    Object.entries(NARRATIVE_TAGS_WORKER_NUMERIC_DEFAULTS)
      .map(([key, defaultValue]) => [key, config[key as NarrativeTagsNumericConfigKey] ?? defaultValue])
  ) as Record<NarrativeTagsNumericConfigKey, number>
}

const resolveNarrativeTagsWorkerBooleanConfig = (config: NarrativeTagsSlotTargetConfig) => ({
  allowDynamicTagSuggestions: config.allowDynamicTagSuggestions === true,
  useEmbeddingCache: config.useEmbeddingCache === true,
  useBrowserCache: config.useBrowserCache === true
})

/**
 * Combines target text, locale, worker defaults, and sourced definitions into a scoring payload.
 */
export const buildNarrativeTagsWorkerPayload = (
  text: string,
  locale: 'en' | 'fr',
  config: NarrativeTagsSlotTargetConfig | null,
  tags: NarrativeTagDefinitionWithSource[]
) => ({
  text,
  locale,
  ...resolveNarrativeTagsWorkerConfig(config),
  tags
})

/**
 * Builds the primitive dependency snapshot used to reschedule suggestions when target inputs change.
 */
export const buildNarrativeTagsSuggestionWatchState = (
  target: NarrativeTagsEntityTarget | null,
  locale: 'en' | 'fr',
  availableTagDefinitions: NarrativeTagDefinitionWithSource[],
  enabled: boolean,
  targetConfig: NarrativeTagsSlotTargetConfig | null
) => ({
  text: target?.text ?? '',
  target: target?.targetKey ?? '',
  locale,
  keys: availableTagDefinitions.map(tag => `${narrativeTagSourceKey(tag.source)}:${tag.key}`).join('|'),
  enabled,
  targetEnabled: targetConfig?.enabled === true,
  targetCustom: targetConfig?.allowCustomTags === true,
  targetDynamic: targetConfig?.allowDynamicTagSuggestions === true,
  targetScore: targetConfig?.minScore ?? 0,
  targetDynamicScore: targetConfig?.minDynamicScore ?? 0,
  targetSuggestions: targetConfig?.maxSuggestions ?? 0,
  targetDynamicTags: targetConfig?.maxDynamicTags ?? 0
})

/**
 * Ranks available definitions by keyword overlap using the target's predefined suggestion limit.
 */
export const resolveKeywordFallbackSuggestions = (
  targetText: string,
  availableTagDefinitions: NarrativeTagDefinitionWithSource[],
  config: NarrativeTagsSlotTargetConfig | null
) => rankTagsByKeywordOverlap(targetText, availableTagDefinitions, config?.maxSuggestions ?? 0)
