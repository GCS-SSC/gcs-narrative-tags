import { beforeEach, describe, expect, it, vi } from 'vitest'

const extractMock = vi.fn()
const loadModelMock = vi.fn()
const createTransformersTagExtractorMock = vi.fn((_config: unknown) => ({
  loadModel: loadModelMock,
  extract: extractMock
}))
const rankTagsByKeywordOverlapMock = vi.fn((
  _text: unknown,
  _tags: unknown,
  _maxSuggestions: unknown,
  _exactAliasBoost: unknown,
  _locale: unknown,
  _negationPenalty: unknown,
  _negationWindow: unknown
) => [
  { key: 'fallback-tag', score: 0.75 }
])
const resolveTagExtractorConfigMock = vi.fn((config: unknown) => config)
const postMessageMock = vi.fn()
const addEventListenerMock = vi.fn()

vi.mock('@browser-tag-extractor/core/benchmark', () => ({
  createTransformersTagExtractor: (config: unknown) => createTransformersTagExtractorMock(config),
  rankTagsByKeywordOverlap: (
    text: unknown,
    tags: unknown,
    maxSuggestions: unknown,
    exactAliasBoost: unknown,
    locale: unknown,
    negationPenalty: unknown,
    negationWindow: unknown
  ) => rankTagsByKeywordOverlapMock(
    text, tags, maxSuggestions, exactAliasBoost, locale, negationPenalty, negationWindow
  ),
  resolveTagExtractorConfig: (config: unknown) => resolveTagExtractorConfigMock(config)
}))

describe('narrative tags worker source', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('self', {
      postMessage: postMessageMock,
      addEventListener: addEventListenerMock
    })
    loadModelMock.mockResolvedValue(undefined)
    extractMock.mockResolvedValue({
      predefined: [{ key: 'infrastructure', score: 0.82 }],
      dynamic: [{ label: 'regional rail', score: 0.7 }]
    })
  })

  it('normalizes tag definitions before scoring', async () => {
    const { toTagDefinition } = await import('../../client/worker-source')

    expect(toTagDefinition({
      key: ' infrastructure ',
      label: { en: ' Infrastructure ', fr: '' },
      description: { en: ' Capital ', fr: '' },
      aliases: [' roads ', '', null]
    })).toEqual({
      key: 'infrastructure',
      label: {
        en: 'Infrastructure',
        fr: ''
      },
      description: {
        en: 'Capital',
        fr: ''
      },
      aliases: ['roads', 'null']
    })
  })

  it('returns extractor suggestions for valid payloads', async () => {
    const { suggestTags } = await import('../../client/worker-source')

    await expect(suggestTags({
      text: 'The project improves infrastructure.',
      locale: 'en',
      tags: [{
        key: 'infrastructure',
        label: { en: 'Infrastructure', fr: 'Infrastructure' }
      }]
    })).resolves.toEqual([
      { predefined: true, key: 'infrastructure', score: 0.82 },
      { predefined: false, label: 'regional rail', score: 0.7 }
    ])
  })

  it('falls back to keyword overlap when extraction fails', async () => {
    extractMock.mockRejectedValueOnce(new Error('model failed'))
    const { suggestTags } = await import('../../client/worker-source')

    await expect(suggestTags({
      text: 'The project improves infrastructure.',
      locale: 'en',
      tags: [{
        key: 'infrastructure',
        label: { en: 'Infrastructure', fr: 'Infrastructure' }
      }]
    })).resolves.toEqual([
      { predefined: true, key: 'fallback-tag', score: 0.75 }
    ])
  })

  it('clamps mixed persisted settings and reverses an invalid dynamic n-gram range', async () => {
    const { suggestTags } = await import('../../client/worker-source')

    await suggestTags({
      text: ' Projet communautaire ',
      locale: 'fr',
      minScore: '2',
      maxSuggestions: 99,
      allowDynamicTagSuggestions: true,
      maxDynamicTags: 'invalid',
      minDynamicScore: -1,
      dynamicNgramMin: 5,
      dynamicNgramMax: 2,
      semanticWeight: Number.NaN,
      lexicalWeight: 2,
      exactAliasBoost: -1,
      negationPenalty: '0.2',
      negationWindow: 30,
      useBrowserCache: false,
      useEmbeddingCache: false,
      tags: [{
        key: ' community ',
        label: { en: ' Community ' },
        description: { en: ' Benefit ' },
        aliases: 'not-an-array'
      }]
    })

    expect(resolveTagExtractorConfigMock).toHaveBeenCalledWith(expect.objectContaining({
      minScore: 1,
      maxSuggestions: 12,
      maxDynamicTags: 99,
      minDynamicScore: 0,
      semanticWeight: 0.75,
      lexicalWeight: 1,
      exactAliasBoost: 0,
      negationPenalty: 0.2,
      negationWindow: 20,
      modelSource: expect.objectContaining({ useBrowserCache: false }),
      execution: expect.objectContaining({ useEmbeddingCache: false })
    }))
    expect(extractMock).toHaveBeenCalledWith(expect.objectContaining({
      locale: 'fr',
      config: expect.objectContaining({ dynamicNgramMin: 2, dynamicNgramMax: 5 })
    }))
  })

  it('returns early for missing text or usable tag definitions', async () => {
    const { suggestTags } = await import('../../client/worker-source')

    await expect(suggestTags({ text: ' ', tags: [{ key: 'tag', label: { en: 'Tag' } }] })).resolves.toEqual([])
    await expect(suggestTags({ text: 'Text', tags: 'invalid' })).resolves.toEqual([])
    await expect(suggestTags({ text: 'Text', tags: [{ key: '', label: { en: 'Tag' } }, { key: 'tag' }] })).resolves.toEqual([])
    expect(createTransformersTagExtractorMock).not.toHaveBeenCalled()
  })

  it('reuses the extractor for equal config and reloads it when config changes', async () => {
    const { suggestTags } = await import('../../client/worker-source')
    const payload = {
      text: 'Infrastructure',
      tags: [{ key: 'infrastructure', label: { en: 'Infrastructure' } }]
    }

    await suggestTags(payload)
    await suggestTags(payload)
    await suggestTags({ ...payload, minScore: 0.9 })

    expect(createTransformersTagExtractorMock).toHaveBeenCalledTimes(2)
  })

  it('handles worker messages and reports Error and primitive failures', async () => {
    await import('../../client/worker-source')
    const listener = addEventListenerMock.mock.calls[0]?.[1] as (event: { data?: unknown }) => void

    listener({ data: { type: 'ignored' } })
    expect(postMessageMock).not.toHaveBeenCalled()

    listener({ data: { type: 'suggest', payload: {} } })
    await vi.waitFor(() => expect(postMessageMock).toHaveBeenCalledWith({
      kind: 'result', requestId: 0, suggestions: []
    }))

    resolveTagExtractorConfigMock.mockImplementationOnce(() => { throw new Error('bad config') })
    listener({ data: { type: 'suggest', requestId: 7, payload: { text: 'Text' } } })
    await vi.waitFor(() => expect(postMessageMock).toHaveBeenCalledWith({
      kind: 'error', requestId: 7, error: 'bad config'
    }))

    resolveTagExtractorConfigMock.mockImplementationOnce(() => { throw 'bad config' })
    listener({ data: { type: 'suggest', requestId: 8, payload: { text: 'Text' } } })
    await vi.waitFor(() => expect(postMessageMock).toHaveBeenCalledWith({
      kind: 'error', requestId: 8, error: 'NARRATIVE_TAGS_WORKER_ERROR'
    }))
  })

  it('loads safely when evaluated outside a worker global', async () => {
    vi.unstubAllGlobals()
    await expect(import('../../client/worker-source')).resolves.toMatchObject({
      suggestTags: expect.any(Function)
    })
    expect(addEventListenerMock).not.toHaveBeenCalled()
  })
})
