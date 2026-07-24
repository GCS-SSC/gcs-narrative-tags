import { GCS_TEXTAREA_TARGETS } from '@gcs-ssc/extensions'
import type { GcsTextareaKnownTargetKey, JsonValue } from '@gcs-ssc/extensions'

export type NarrativeTagLocale = 'en' | 'fr'

export interface NarrativeTagDefinition {
  key: string
  label: Record<NarrativeTagLocale, string>
  description: Record<NarrativeTagLocale, string>
  aliases: string[]
  color: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'
}

export interface NarrativeTagSource {
  agencyId: string
  agencyName?: Record<NarrativeTagLocale, string>
  agencyAbbreviation?: Record<NarrativeTagLocale, string>
  streamId?: string
  streamName?: Record<NarrativeTagLocale, string>
}

export interface NarrativeTagSourceConfig {
  source: NarrativeTagSource
  config: NarrativeTagsConfig
}

export type NarrativeTagDefinitionWithSource = NarrativeTagDefinition & {
  source?: NarrativeTagSource
}

export interface NarrativeTagsTargetConfig {
  enabled: boolean
  allowCustomTags: boolean
  allowDynamicTagSuggestions: boolean
  minScore: number
  maxSuggestions: number
  minDynamicScore: number
  maxDynamicTags: number
  dynamicNgramMin: number
  dynamicNgramMax: number
  semanticWeight: number
  lexicalWeight: number
  exactAliasBoost: number
  negationPenalty: number
  negationWindow: number
  useEmbeddingCache: boolean
  useBrowserCache: boolean
}

export interface NarrativeTagsConfig {
  enabled: boolean
  targets: Record<GcsTextareaKnownTargetKey, NarrativeTagsTargetConfig>
  tags: NarrativeTagDefinition[]
}

export type NarrativeTagValue =
  | {
    predefined: true
    key: string
    label: string
    source?: NarrativeTagSource
  }
  | {
    predefined: false
    label: string
    source?: NarrativeTagSource
  }

export interface NarrativeTagsDescriptionsContext {
  kind: 'agreement.descriptions' | 'proponent.descriptions'
  descriptions?: {
    en?: string
    fr?: string
  }
  streamId?: string
  agreementId?: string
  agencyId?: string
  applicantRecipientId?: string
  extensions: Record<string, Record<string, unknown>>
  setExtensionPayload?: (extensionKey: string, payloadKey: string, value: unknown) => void
}

export interface NarrativeTagsContext {
  kind?: string
  descriptions?: {
    en?: string
    fr?: string
  }
  streamId?: string
  agreementId?: string
  agencyId?: string
  applicantRecipientId?: string
  extensions?: Record<string, Record<string, unknown>>
  setExtensionPayload?: (extensionKey: string, payloadKey: string, value: unknown) => void
}

export interface NarrativeTagsEntityTarget {
  targetKey: GcsTextareaKnownTargetKey
  label: string
  text: string
  streamId?: string
  agencyId?: string
  ownerType?: string
  ownerId?: string
  extensions: Record<string, Record<string, unknown>>
  setExtensionPayload?: (extensionKey: string, payloadKey: string, value: unknown) => void
}

export type NarrativeTagSuggestion =
  | {
    predefined: true
    key: string
    score: number
    source?: NarrativeTagSource
  }
  | {
    predefined: false
    label: string
    score: number
    source?: NarrativeTagSource
  }

export const AGREEMENT_TAG_COLORS: NarrativeTagDefinition['color'][] = [
  'primary',
  'secondary',
  'success',
  'info',
  'warning',
  'error',
  'neutral'
]

export const DEFAULT_NARRATIVE_TAGS: NarrativeTagDefinition[] = [
  {
    key: 'community-benefit',
    label: {
      en: 'Community benefit',
      fr: 'Avantage communautaire'
    },
    description: {
      en: 'The agreement describes direct benefits for communities or public users.',
      fr: 'L’entente décrit des avantages directs pour les collectivités ou les utilisateurs publics.'
    },
    aliases: ['community impact', 'public benefit', 'local benefit'],
    color: 'success'
  },
  {
    key: 'capacity-building',
    label: {
      en: 'Capacity building',
      fr: 'Renforcement des capacités'
    },
    description: {
      en: 'The agreement supports skills, training, operations, tools, or organizational capacity.',
      fr: 'L’entente appuie les compétences, la formation, les opérations, les outils ou la capacité organisationnelle.'
    },
    aliases: ['training', 'skills', 'organizational capacity'],
    color: 'info'
  },
  {
    key: 'infrastructure',
    label: {
      en: 'Infrastructure',
      fr: 'Infrastructure'
    },
    description: {
      en: 'The agreement involves construction, equipment, facilities, or capital assets.',
      fr: 'L’entente vise la construction, l’équipement, les installations ou les immobilisations.'
    },
    aliases: ['capital project', 'equipment', 'facility'],
    color: 'neutral'
  }
]

const DEFAULT_TARGET_CONFIG: NarrativeTagsTargetConfig = {
  enabled: true,
  allowCustomTags: false,
  allowDynamicTagSuggestions: false,
  minScore: 0.36,
  maxSuggestions: 4,
  minDynamicScore: 0.34,
  maxDynamicTags: 4,
  dynamicNgramMin: 1,
  dynamicNgramMax: 3,
  semanticWeight: 0.75,
  lexicalWeight: 0.25,
  exactAliasBoost: 0.45,
  negationPenalty: 0.45,
  negationWindow: 6,
  useEmbeddingCache: true,
  useBrowserCache: true
}

const DEFAULT_CONFIG: NarrativeTagsConfig = {
  enabled: true,
  targets: {
    'agreement.description': { ...DEFAULT_TARGET_CONFIG },
    'proponent.description': { ...DEFAULT_TARGET_CONFIG }
  },
  tags: DEFAULT_NARRATIVE_TAGS
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const asString = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback

const asBoolean = (value: unknown, fallback: boolean): boolean => typeof value === 'boolean' ? value : fallback

const asNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const numericValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numericValue)) {
    return fallback
  }

  return Math.min(max, Math.max(min, numericValue))
}

/**
 * Canonicalizes a label to a lowercase ASCII kebab key with surrounding separators removed.
 */
export const normalizeNarrativeTagKey = (value: string): string => value
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')

const normalizeLabel = (value: unknown, fallback: Record<NarrativeTagLocale, string>): Record<NarrativeTagLocale, string> => {
  const record = isRecord(value) ? value : {}
  return {
    en: asString(record.en, fallback.en).trim(),
    fr: asString(record.fr, fallback.fr).trim()
  }
}

/**
 * Normalizes a tag source only when it has a non-empty agency id, with optional bilingual display metadata.
 */
export const normalizeNarrativeTagSource = (value: unknown): NarrativeTagSource | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const agencyId = asString(value.agencyId).trim()
  if (!agencyId) {
    return undefined
  }

  const streamId = asString(value.streamId).trim()
  return {
    agencyId,
    agencyName: isRecord(value.agencyName)
      ? normalizeLabel(value.agencyName, { en: agencyId, fr: agencyId })
      : undefined,
    agencyAbbreviation: isRecord(value.agencyAbbreviation)
      ? normalizeLabel(value.agencyAbbreviation, { en: agencyId, fr: agencyId })
      : undefined,
    streamId: streamId || undefined,
    streamName: isRecord(value.streamName)
      ? normalizeLabel(value.streamName, { en: streamId || agencyId, fr: streamId || agencyId })
      : undefined
  }
}

/**
 * Produces an agency-and-stream identity key, using an agency sentinel when no stream is present.
 */
export const narrativeTagSourceKey = (source?: NarrativeTagSource): string => {
  if (!source?.agencyId) {
    return ''
  }

  return `${source.agencyId}:${source.streamId ?? 'agency'}`
}

/**
 * Compares sources by their normalized agency-and-stream identity.
 */
export const sameNarrativeTagSource = (left?: NarrativeTagSource, right?: NarrativeTagSource): boolean =>
  narrativeTagSourceKey(left) === narrativeTagSourceKey(right)

/**
 * Formats the localized agency label and optional stream label for sourced tag display.
 */
export const narrativeTagSourceLabel = (
  source: NarrativeTagSource | undefined,
  locale: NarrativeTagLocale
): string => {
  if (!source) {
    return ''
  }

  const agencyLabel = source.agencyAbbreviation
    ? locale === 'fr' ? source.agencyAbbreviation.fr : source.agencyAbbreviation.en
    : source.agencyName
      ? locale === 'fr' ? source.agencyName.fr : source.agencyName.en
      : source.agencyId
  const streamLabel = source.streamName
    ? locale === 'fr' ? source.streamName.fr : source.streamName.en
    : source.streamId

  return streamLabel ? `${agencyLabel} / ${streamLabel}` : agencyLabel
}

const normalizeAliases = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(new Set(value.map(item => asString(item).trim()).filter(item => item.length > 0)))
}

const normalizeColor = (value: unknown, fallback: NarrativeTagDefinition['color']): NarrativeTagDefinition['color'] =>
  AGREEMENT_TAG_COLORS.includes(value as NarrativeTagDefinition['color'])
    ? value as NarrativeTagDefinition['color']
    : fallback

const getTargetConfigValue = (
  record: Record<string, unknown>,
  legacyConfig: Record<string, unknown>,
  key: keyof NarrativeTagsTargetConfig
): unknown => record[key] ?? legacyConfig[key]

/**
 * Merges target, legacy root, and default settings while clamping numeric values and ordering n-gram bounds.
 */
const normalizeTargetConfig = (
  value: unknown,
  legacyConfig: Record<string, unknown>,
  fallback: NarrativeTagsTargetConfig
): NarrativeTagsTargetConfig => {
  const record = isRecord(value) ? value : {}
  const enabledFallback = typeof value === 'boolean' ? value : fallback.enabled
  const dynamicNgramMin = Math.round(asNumber(getTargetConfigValue(record, legacyConfig, 'dynamicNgramMin'), fallback.dynamicNgramMin, 1, 5))
  const dynamicNgramMax = Math.round(asNumber(getTargetConfigValue(record, legacyConfig, 'dynamicNgramMax'), fallback.dynamicNgramMax, 1, 5))
  const minDynamicNgram = Math.min(dynamicNgramMin, dynamicNgramMax)
  const maxDynamicNgram = Math.max(dynamicNgramMin, dynamicNgramMax)

  return {
    enabled: asBoolean(record.enabled, enabledFallback),
    allowCustomTags: asBoolean(getTargetConfigValue(record, legacyConfig, 'allowCustomTags'), fallback.allowCustomTags),
    allowDynamicTagSuggestions: asBoolean(getTargetConfigValue(record, legacyConfig, 'allowDynamicTagSuggestions'), fallback.allowDynamicTagSuggestions),
    minScore: asNumber(getTargetConfigValue(record, legacyConfig, 'minScore'), fallback.minScore, 0, 1),
    maxSuggestions: Math.round(asNumber(getTargetConfigValue(record, legacyConfig, 'maxSuggestions'), fallback.maxSuggestions, 1, 12)),
    minDynamicScore: asNumber(getTargetConfigValue(record, legacyConfig, 'minDynamicScore'), fallback.minDynamicScore, 0, 1),
    maxDynamicTags: Math.round(asNumber(getTargetConfigValue(record, legacyConfig, 'maxDynamicTags'), fallback.maxDynamicTags, 1, 12)),
    dynamicNgramMin: minDynamicNgram,
    dynamicNgramMax: maxDynamicNgram,
    semanticWeight: asNumber(getTargetConfigValue(record, legacyConfig, 'semanticWeight'), fallback.semanticWeight, 0, 1),
    lexicalWeight: asNumber(getTargetConfigValue(record, legacyConfig, 'lexicalWeight'), fallback.lexicalWeight, 0, 1),
    exactAliasBoost: asNumber(getTargetConfigValue(record, legacyConfig, 'exactAliasBoost'), fallback.exactAliasBoost, 0, 1),
    negationPenalty: asNumber(getTargetConfigValue(record, legacyConfig, 'negationPenalty'), fallback.negationPenalty, 0, 1),
    negationWindow: Math.round(asNumber(getTargetConfigValue(record, legacyConfig, 'negationWindow'), fallback.negationWindow, 0, 20)),
    useEmbeddingCache: asBoolean(getTargetConfigValue(record, legacyConfig, 'useEmbeddingCache'), fallback.useEmbeddingCache),
    useBrowserCache: asBoolean(getTargetConfigValue(record, legacyConfig, 'useBrowserCache'), fallback.useBrowserCache)
  }
}

const normalizeTargets = (
  value: unknown,
  legacyConfig: Record<string, unknown>
): Record<GcsTextareaKnownTargetKey, NarrativeTagsTargetConfig> => {
  const record = isRecord(value) ? value : {}
  return GCS_TEXTAREA_TARGETS.reduce<Record<GcsTextareaKnownTargetKey, NarrativeTagsTargetConfig>>((acc, target) => {
    acc[target.key] = normalizeTargetConfig(record[target.key], legacyConfig, DEFAULT_CONFIG.targets[target.key])
    return acc
  }, {
    'agreement.description': { ...DEFAULT_CONFIG.targets['agreement.description'] },
    'proponent.description': { ...DEFAULT_CONFIG.targets['proponent.description'] }
  })
}

const normalizeTag = (value: unknown, fallback: NarrativeTagDefinition, index: number): NarrativeTagDefinition | null => {
  const record = isRecord(value) ? value : {}
  const key = normalizeNarrativeTagKey(asString(record.key, fallback.key || `tag-${index + 1}`))
  const label = normalizeLabel(record.label, fallback.label)
  const description = normalizeLabel(record.description, fallback.description)

  if (!key || !label.en || !label.fr) {
    return null
  }

  return {
    key,
    label,
    description,
    aliases: normalizeAliases(record.aliases),
    color: normalizeColor(record.color, fallback.color)
  }
}

/**
 * Normalizes target settings and unique tag definitions, restoring cloned defaults when no valid tags remain.
 */
export const normalizeNarrativeTagsConfig = (value: unknown): NarrativeTagsConfig => {
  const record = isRecord(value) ? value : {}
  const rawTags = Array.isArray(record.tags) ? record.tags : DEFAULT_CONFIG.tags
  const seenKeys = new Set<string>()
  const tags = rawTags.flatMap((item, index) => {
    const fallback = DEFAULT_CONFIG.tags[index] ?? {
      key: `tag-${index + 1}`,
      label: { en: `Tag ${index + 1}`, fr: `Étiquette ${index + 1}` },
      description: { en: '', fr: '' },
      aliases: [],
      color: 'neutral' as const
    }
    const normalized = normalizeTag(item, fallback, index)
    if (!normalized || seenKeys.has(normalized.key)) {
      return []
    }

    seenKeys.add(normalized.key)
    return [normalized]
  })

  return {
    enabled: asBoolean(record.enabled, DEFAULT_CONFIG.enabled),
    targets: normalizeTargets(record.targets, record),
    tags: tags.length > 0 ? tags : DEFAULT_CONFIG.tags.map(tag => ({ ...tag, label: { ...tag.label }, description: { ...tag.description }, aliases: [...tag.aliases] }))
  }
}

/**
 * Returns the configured target settings, falling back to the built-in target defaults.
 */
export const getNarrativeTagsTargetConfig = (
  config: NarrativeTagsConfig,
  targetKey: GcsTextareaKnownTargetKey
): NarrativeTagsTargetConfig => config.targets[targetKey] ?? DEFAULT_CONFIG.targets[targetKey]

/**
 * Projects normalized settings and tag definitions into the extension's JSON-compatible config shape.
 */
export const toNarrativeTagsJson = (config: NarrativeTagsConfig): Record<string, JsonValue> => ({
  enabled: config.enabled,
  targets: config.targets as unknown as JsonValue,
  tags: config.tags.map(tag => ({
    key: tag.key,
    label: tag.label,
    description: tag.description,
    aliases: tag.aliases,
    color: tag.color
  }))
})

const combinedDescriptionText = (descriptions: { en?: string; fr?: string }) => [
  asString(descriptions.en).trim(),
  asString(descriptions.fr).trim()
].filter(item => item.length > 0).join('\n\n')

/**
 * Normalizes supported agreement or proponent description contexts, including legacy owner-id aliases.
 */
export const resolveNarrativeTagsDescriptionsContext = (context: Record<string, unknown>): NarrativeTagsDescriptionsContext | null => {
  if (context.kind !== 'agreement.descriptions' && context.kind !== 'proponent.descriptions') {
    return null
  }
  const descriptions = isRecord(context.descriptions) ? context.descriptions : {}
  const extensions = isRecord(context.extensions) ? context.extensions as Record<string, Record<string, unknown>> : {}
  const setExtensionPayload = typeof context.setExtensionPayload === 'function'
    ? context.setExtensionPayload as NarrativeTagsDescriptionsContext['setExtensionPayload']
    : undefined

  return {
    kind: context.kind,
    descriptions: {
      en: asString(descriptions.en).trim(),
      fr: asString(descriptions.fr).trim()
    },
    streamId: asString(context.streamId),
    agreementId: asString(context.agreementId),
    agencyId: asString(context.agencyId),
    applicantRecipientId: asString(context.applicantRecipientId || context.proponentId || context.ownerId),
    extensions,
    setExtensionPayload
  }
}

/**
 * Exposes description-context normalization under the host textarea integration contract.
 */
export const resolveNarrativeTagsTextareaContext = resolveNarrativeTagsDescriptionsContext

/**
 * Resolves a non-empty description context to its agreement or proponent persistence target.
 */
export const resolveNarrativeTagsEntityTarget = (context: Record<string, unknown>): NarrativeTagsEntityTarget | null => {
  const descriptionsContext = resolveNarrativeTagsDescriptionsContext(context)
  if (!descriptionsContext?.descriptions) {
    return null
  }

  const text = combinedDescriptionText(descriptionsContext.descriptions)
  if (!text) {
    return null
  }

  if (descriptionsContext.kind === 'agreement.descriptions') {
    return {
      targetKey: 'agreement.description',
      label: 'Agreement descriptions',
      text,
      streamId: descriptionsContext.streamId,
      ownerType: 'fundingcaseagreement',
      ownerId: descriptionsContext.agreementId,
      extensions: descriptionsContext.extensions,
      setExtensionPayload: descriptionsContext.setExtensionPayload
    }
  }

  return {
    targetKey: 'proponent.description',
    label: 'Proponent descriptions',
    text,
    agencyId: descriptionsContext.agencyId,
    ownerType: 'applicantrecipient',
    ownerId: descriptionsContext.applicantRecipientId,
    extensions: descriptionsContext.extensions,
    setExtensionPayload: descriptionsContext.setExtensionPayload
  }
}

/**
 * Builds English embedding input from a tag's label, description, and non-empty aliases.
 */
export const buildTagEmbeddingText = (tag: NarrativeTagDefinition): string => [
  tag.label.en,
  tag.description.en,
  ...tag.aliases
].map(item => item.trim()).filter(item => item.length > 0).join('. ')

const tokenize = (value: string): string[] => value
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter(token => token.length > 2)

/**
 * Ranks tags by token overlap plus exact-alias boost, returning only positive scores up to the limit.
 */
export const rankTagsByKeywordOverlap = (
  text: string,
  tags: NarrativeTagDefinitionWithSource[],
  maxSuggestions: number
): NarrativeTagSuggestion[] => {
  const textTokens = new Set(tokenize(text))
  if (textTokens.size === 0) {
    return []
  }

  return tags
    .map(tag => {
      const tagTokens = new Set(tokenize(buildTagEmbeddingText(tag)))
      const hits = Array.from(tagTokens).filter(token => textTokens.has(token)).length
      const aliasHits = tag.aliases
        .map(alias => tokenize(alias))
        .filter(aliasTokens => aliasTokens.length > 0 && aliasTokens.every(token => textTokens.has(token))).length
      const boost = aliasHits > 0 ? 0.45 : 0
      return {
        predefined: true as const,
        key: tag.key,
        score: Math.min(1, (tagTokens.size > 0 ? hits / tagTokens.size : 0) + boost),
        source: tag.source
      }
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSuggestions)
}

/**
 * Collects the configured predefined tag keys for membership validation.
 */
export const validTagKeys = (config: NarrativeTagsConfig): Set<string> =>
  new Set(config.tags.map(tag => tag.key))

const normalizeCustomLabel = (value: string): string => value.trim().replace(/\s+/g, ' ')

/**
 * Builds a source-scoped identity for either a predefined key or normalized custom label.
 */
export const tagValueKey = (tag: NarrativeTagValue): string =>
  `${narrativeTagSourceKey(tag.source)}:${tag.predefined ? `predefined:${tag.key}` : `custom:${normalizeNarrativeTagKey(tag.label)}`}`

/**
 * Creates a predefined value with the requested localized label and optional source metadata.
 */
export const makePredefinedTagValue = (
  tag: NarrativeTagDefinition,
  locale: NarrativeTagLocale,
  source?: NarrativeTagSource
): NarrativeTagValue => ({
  predefined: true,
  key: tag.key,
  label: locale === 'fr' ? tag.label.fr : tag.label.en,
  source
})

const appendUniqueNarrativeTagValue = (
  value: NarrativeTagValue,
  seenKeys: Set<string>,
  normalized: NarrativeTagValue[]
) => {
  const uniqueKey = tagValueKey(value)
  if (seenKeys.has(uniqueKey)) {
    return false
  }

  seenKeys.add(uniqueKey)
  normalized.push(value)
  return true
}

const normalizeStringNarrativeTagValue = (
  item: string,
  allowedTags: Map<string, NarrativeTagDefinition>,
  locale: NarrativeTagLocale
) => {
  const key = item.trim()
  const tag = allowedTags.get(key)
  if (!tag) {
    return null
  }

  return makePredefinedTagValue(tag, locale)
}

const normalizePredefinedNarrativeTagValue = (
  item: Record<string, unknown>,
  allowedTags: Map<string, NarrativeTagDefinition>,
  locale: NarrativeTagLocale
) => {
  const key = asString(item.key).trim()
  const tag = allowedTags.get(key)
  if (!tag) {
    return null
  }

  return makePredefinedTagValue(tag, locale, normalizeNarrativeTagSource(item.source))
}

const normalizeCustomNarrativeTagValue = (
  item: Record<string, unknown>,
  targetConfig: NarrativeTagsTargetConfig
) => {
  if (!targetConfig.allowCustomTags) {
    return null
  }

  const label = normalizeCustomLabel(asString(item.label))
  if (!label || label.length > 80) {
    return null
  }

  return {
    predefined: false,
    label,
    source: normalizeNarrativeTagSource(item.source)
  } satisfies NarrativeTagValue
}

/**
 * Dispatches legacy strings and structured values to predefined or custom tag normalization.
 */
const normalizeNarrativeTagItem = (
  item: unknown,
  allowedTags: Map<string, NarrativeTagDefinition>,
  targetConfig: NarrativeTagsTargetConfig,
  locale: NarrativeTagLocale
) => {
  if (typeof item === 'string') {
    return normalizeStringNarrativeTagValue(item, allowedTags, locale)
  }

  if (!isRecord(item) || typeof item.predefined !== 'boolean') {
    return null
  }

  if (item.predefined) {
    return normalizePredefinedNarrativeTagValue(item, allowedTags, locale)
  }

  return normalizeCustomNarrativeTagValue(item, targetConfig)
}

/**
 * Normalizes an entire tag array atomically, rejecting invalid, disallowed, or duplicate values.
 */
export const normalizeNarrativeTagValues = (
  config: NarrativeTagsConfig,
  tags: unknown,
  locale: NarrativeTagLocale = 'en',
  targetKey: GcsTextareaKnownTargetKey = 'agreement.description'
): NarrativeTagValue[] | null => {
  if (!Array.isArray(tags)) {
    return null
  }

  const allowedTags = new Map(config.tags.map(tag => [tag.key, tag]))
  const targetConfig = getNarrativeTagsTargetConfig(config, targetKey)
  const seenKeys = new Set<string>()
  const normalized: NarrativeTagValue[] = []

  for (const item of tags) {
    const value = normalizeNarrativeTagItem(item, allowedTags, targetConfig, locale)
    if (!value || !appendUniqueNarrativeTagValue(value, seenKeys, normalized)) return null
  }

  return normalized
}
