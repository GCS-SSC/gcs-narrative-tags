import {
  createTransformersTagExtractor,
  rankTagsByKeywordOverlap,
  resolveTagExtractorConfig
} from '@browser-tag-extractor/core/benchmark'

const MODEL_BASE_PATH = '/extensions/gcs-narrative-tags/models/'

let extractorPromise = null
let serializedConfig = ''

const asNumber = (value, fallback, min, max) => {
  const numericValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numericValue)) {
    return fallback
  }

  return Math.min(max, Math.max(min, numericValue))
}

const asBoolean = (value, fallback) => typeof value === 'boolean' ? value : fallback

/**
 * Clamps worker settings and fixes model execution to the bundled local CPU assets.
 */
const resolveConfig = payload => resolveTagExtractorConfig({
  minScore: asNumber(payload.minScore, 0.36, 0, 1),
  maxSuggestions: Math.round(asNumber(payload.maxSuggestions, 4, 1, 12)),
  maxDynamicTags: asBoolean(payload.allowDynamicTagSuggestions, false)
    ? Math.round(asNumber(payload.maxDynamicTags, payload.maxSuggestions, 1, 12))
    : 0,
  minDynamicScore: asNumber(payload.minDynamicScore, 0.34, 0, 1),
  dynamicNgramMin: Math.round(asNumber(payload.dynamicNgramMin, 1, 1, 5)),
  dynamicNgramMax: Math.round(asNumber(payload.dynamicNgramMax, 3, 1, 5)),
  semanticWeight: asNumber(payload.semanticWeight, 0.75, 0, 1),
  lexicalWeight: asNumber(payload.lexicalWeight, 0.25, 0, 1),
  exactAliasBoost: asNumber(payload.exactAliasBoost, 0.45, 0, 1),
  negationPenalty: asNumber(payload.negationPenalty, 0.45, 0, 1),
  negationWindow: Math.round(asNumber(payload.negationWindow, 6, 0, 20)),
  modelSource: {
    mode: 'local',
    localModelPath: MODEL_BASE_PATH,
    useBrowserCache: asBoolean(payload.useBrowserCache, true)
  },
  execution: {
    device: 'cpu',
    useEmbeddingCache: asBoolean(payload.useEmbeddingCache, true)
  }
})

const getExtractor = async config => {
  const nextSerializedConfig = JSON.stringify(config)
  if (!extractorPromise || serializedConfig !== nextSerializedConfig) {
    const extractor = createTransformersTagExtractor(config)
    serializedConfig = nextSerializedConfig
    extractorPromise = extractor.loadModel().then(() => extractor)
  }

  return await extractorPromise
}

/**
 * Converts an unknown tag-like object to the trimmed bilingual definition consumed by the extractor.
 */
export const toTagDefinition = tag => ({
  key: String(tag.key ?? '').trim(),
  label: {
    en: String(tag.label?.en ?? '').trim(),
    fr: String(tag.label?.fr ?? tag.label?.en ?? '').trim()
  },
  description: {
    en: String(tag.description?.en ?? '').trim(),
    fr: String(tag.description?.fr ?? tag.description?.en ?? '').trim()
  },
  aliases: Array.isArray(tag.aliases)
    ? tag.aliases.map(alias => String(alias).trim()).filter(alias => alias.length > 0)
    : []
})

const toSuggestions = result => [
  ...result.predefined.map(item => ({
    predefined: true,
    key: item.key,
    score: item.score
  })),
  ...result.dynamic.map(item => ({
    predefined: false,
    label: item.label,
    score: item.score
  }))
]

const fallbackSuggestions = (text, tags, config, locale) => rankTagsByKeywordOverlap(
  text,
  tags,
  config.maxSuggestions,
  config.exactAliasBoost,
  locale,
  config.negationPenalty,
  config.negationWindow
).map(item => ({
  predefined: true,
  key: item.key,
  score: item.score
}))

const normalizeDynamicRange = payload => {
  if (payload.dynamicNgramMin <= payload.dynamicNgramMax) {
    return payload
  }

  return {
    ...payload,
    dynamicNgramMin: payload.dynamicNgramMax,
    dynamicNgramMax: payload.dynamicNgramMin
  }
}

/**
 * Extracts semantic suggestions for valid input, falling back to keyword overlap when model scoring fails.
 */
export const suggestTags = async payload => {
  const text = String(payload.text ?? '').trim()
  const tags = Array.isArray(payload.tags) ? payload.tags.map(toTagDefinition).filter(tag => tag.key && tag.label.en) : []
  const config = normalizeDynamicRange(resolveConfig(payload))
  const locale = payload.locale === 'fr' ? 'fr' : 'en'

  if (!text || tags.length === 0) {
    return []
  }

  try {
    const extractor = await getExtractor(config)
    const result = await extractor.extract({
      text,
      tags,
      locale,
      config: {
        minScore: config.minScore,
        maxSuggestions: config.maxSuggestions,
        maxDynamicTags: config.maxDynamicTags,
        minDynamicScore: config.minDynamicScore,
        dynamicNgramMin: config.dynamicNgramMin,
        dynamicNgramMax: config.dynamicNgramMax,
        semanticWeight: config.semanticWeight,
        lexicalWeight: config.lexicalWeight,
        exactAliasBoost: config.exactAliasBoost,
        negationPenalty: config.negationPenalty,
        negationWindow: config.negationWindow
      }
    })

    return toSuggestions(result)
  } catch {
    return fallbackSuggestions(text, tags, config, locale)
  }
}

if (typeof self !== 'undefined') {
  self.addEventListener('message', event => {
    if (event.data?.type !== 'suggest') {
      return
    }

    const requestId = typeof event.data?.requestId === 'number' ? event.data.requestId : 0
    void suggestTags(event.data.payload ?? {}).then(suggestions => {
      self.postMessage({
        kind: 'result',
        requestId,
        suggestions
      })
    }).catch(error => {
      self.postMessage({
        kind: 'error',
        requestId,
        error: error instanceof Error ? error.message : 'NARRATIVE_TAGS_WORKER_ERROR'
      })
    })
  })
}
