import { describe, expect, it } from 'vitest'
import {
  buildNarrativeTagsSuggestionWatchState,
  buildNarrativeTagsWorkerPayload,
  filterValidPersistedNarrativeTags,
  normalizeNarrativeTagsSourceConfigs,
  resolveEmbeddedNarrativeTags,
  resolveFetchedNarrativeTags,
  resolveKeywordFallbackSuggestions,
  resolveNarrativeTagsRouteUrl,
  resolveNarrativeTagsWorkerSuggestions
} from '../../components/narrative-tags-slot-helpers'
import { normalizeNarrativeTagsConfig } from '../../components/narrative-tags'
import type { NarrativeTagsEntityTarget } from '../../components/narrative-tags'

describe('narrative tags slot helpers', () => {
  it('resolves persisted route URLs for supported target types', () => {
    const agreementTarget: NarrativeTagsEntityTarget = {
      targetKey: 'agreement.description',
      label: 'Agreement',
      text: 'Agreement text',
      streamId: 'stream 1',
      ownerId: 'agreement/1',
      extensions: {}
    }
    const proponentTarget: NarrativeTagsEntityTarget = {
      targetKey: 'proponent.description',
      label: 'Proponent',
      text: 'Proponent text',
      agencyId: 'agency 1',
      ownerId: 'recipient/1',
      extensions: {}
    }

    expect(resolveNarrativeTagsRouteUrl(agreementTarget))
      .toBe('/streams/stream%201/agreements/agreement%2F1/tags')
    expect(resolveNarrativeTagsRouteUrl(proponentTarget))
      .toBe('/agencies/agency%201/applicant-recipients/recipient%2F1/tags')
    expect(resolveNarrativeTagsRouteUrl(null)).toBe('')
  })

  it('filters embedded persisted tags by known keys', () => {
    expect(filterValidPersistedNarrativeTags([
      { predefined: true, key: 'known', label: 'Known' },
      { predefined: true, key: 'missing', label: 'Missing' },
      { predefined: false, label: 'Custom' },
      null
    ], key => key === 'known')).toEqual([
      { predefined: true, key: 'known', label: 'Known' },
      { predefined: false, label: 'Custom' }
    ])
  })

  it('normalizes source configs and filters fetched predefined tags', () => {
    const sources = normalizeNarrativeTagsSourceConfigs([
      {
        source: { agencyId: 'agency-1', agencyName: { en: 'Agency', fr: 'Agence' } },
        config: normalizeNarrativeTagsConfig({
          enabled: true,
          tags: [{
            key: 'known',
            label: { en: 'Known', fr: 'Connue' },
            description: { en: '', fr: '' },
            aliases: [],
            color: 'primary'
          }]
        })
      }
    ])

    expect(sources[0]?.config.tags[0]?.key).toBe('known')
    expect(resolveFetchedNarrativeTags({
      tags: [
        { predefined: true, key: 'known', label: 'Known' },
        { predefined: true, key: 'missing', label: 'Missing' },
        { predefined: false, label: 'Custom' }
      ]
    }, '', key => key === 'known' ? sources[0]?.config.tags[0] : undefined)).toEqual([
      { predefined: true, key: 'known', label: 'Known' },
      { predefined: false, label: 'Custom' }
    ])
  })

  it('normalizes worker suggestions using target thresholds', () => {
    const config = normalizeNarrativeTagsConfig({
      targets: {
        'agreement.description': {
          minScore: 0.5,
          maxSuggestions: 1,
          minDynamicScore: 0.6,
          maxDynamicTags: 1
        }
      }
    }).targets['agreement.description']

    expect(resolveNarrativeTagsWorkerSuggestions([
      { predefined: true, key: 'known', score: 0.7 },
      { predefined: true, key: 'low', score: 0.4 },
      { predefined: false, label: 'Dynamic', score: 0.65 }
    ], config, key => key === 'known'
      ? {
          key: 'known',
          label: { en: 'Known', fr: 'Connue' },
          description: { en: '', fr: '' },
          aliases: [],
          color: 'primary',
          source: { agencyId: 'agency-1', agencyName: { en: 'Agency', fr: 'Agence' } }
        }
      : undefined)).toEqual([
      {
        predefined: true,
        key: 'known',
        score: 0.7,
        source: { agencyId: 'agency-1', agencyName: { en: 'Agency', fr: 'Agence' } }
      },
      { predefined: false, label: 'Dynamic', score: 0.65 }
    ])
  })

  it('builds the worker payload from target config', () => {
    const config = normalizeNarrativeTagsConfig({
      targets: {
        'agreement.description': {
          minScore: 0.5,
          maxSuggestions: 3,
          allowDynamicTagSuggestions: true,
          maxDynamicTags: 2,
          useBrowserCache: true
        }
      }
    }).targets['agreement.description']

    expect(buildNarrativeTagsWorkerPayload('Text', 'en', config, [])).toMatchObject({
      text: 'Text',
      locale: 'en',
      minScore: 0.5,
      maxSuggestions: 3,
      allowDynamicTagSuggestions: true,
      maxDynamicTags: 2,
      useBrowserCache: true,
      tags: []
    })
  })

  it('builds the suggestion watcher state from target text, tag keys, and thresholds', () => {
    const target: NarrativeTagsEntityTarget = {
      targetKey: 'agreement.description',
      label: 'Agreement',
      text: 'Agreement text',
      streamId: 'stream-1',
      ownerId: 'agreement-1',
      extensions: {}
    }
    const config = normalizeNarrativeTagsConfig({
      targets: {
        'agreement.description': {
          enabled: true,
          allowCustomTags: true,
          allowDynamicTagSuggestions: true,
          minScore: 0.45,
          minDynamicScore: 0.6,
          maxSuggestions: 3,
          maxDynamicTags: 2
        }
      }
    }).targets['agreement.description']

    expect(buildNarrativeTagsSuggestionWatchState(target, 'fr', [{
      key: 'housing',
      label: { en: 'Housing', fr: 'Logement' },
      description: { en: '', fr: '' },
      aliases: [],
      color: 'primary',
      source: { agencyId: 'agency-1', agencyName: { en: 'Agency', fr: 'Agence' } }
    }], true, config)).toEqual({
      text: 'Agreement text',
      target: 'agreement.description',
      locale: 'fr',
      keys: 'agency-1:agency:housing',
      enabled: true,
      targetEnabled: true,
      targetCustom: true,
      targetDynamic: true,
      targetScore: 0.45,
      targetDynamicScore: 0.6,
      targetSuggestions: 3,
      targetDynamicTags: 2
    })
  })

  it('fails closed for incomplete routes, source lists, and persisted tag arrays', () => {
    expect(resolveNarrativeTagsRouteUrl({
      targetKey: 'proponent.description', label: 'Proponent', text: 'Text', agencyId: '1', extensions: {}
    })).toBe('')
    expect(normalizeNarrativeTagsSourceConfigs(undefined)).toEqual([])
    expect(filterValidPersistedNarrativeTags('invalid', () => true)).toEqual([])
  })

  it('reads field-specific embedded tags only from an object extension payload', () => {
    const target: NarrativeTagsEntityTarget = {
      targetKey: 'agreement.description',
      label: 'Agreement',
      text: 'Text',
      streamId: '1',
      ownerId: '2',
      extensions: {
        'gcs-narrative-tags': {
          textFieldTags: {
            description: [{ predefined: true, key: 'known', label: 'Known' }]
          }
        }
      }
    }
    expect(resolveEmbeddedNarrativeTags(target, 'description', key => key === 'known'))
      .toEqual([{ predefined: true, key: 'known', label: 'Known' }])
    expect(resolveEmbeddedNarrativeTags(target, '', () => true)).toEqual([])
    expect(resolveEmbeddedNarrativeTags(null, 'description', () => true)).toEqual([])
    expect(resolveEmbeddedNarrativeTags({
      ...target, extensions: { 'gcs-narrative-tags': { textFieldTags: 'invalid' } }
    }, 'description', () => true)).toEqual([])
  })

  it('selects fetched field tags with entity-tag fallback', () => {
    const response = {
      tags: [{ predefined: false as const, label: 'Legacy' }],
      textFieldTags: {
        description: [{ predefined: false as const, label: 'Field' }]
      }
    }
    expect(resolveFetchedNarrativeTags(response, 'description', () => undefined))
      .toEqual([{ predefined: false, label: 'Field' }])
    expect(resolveFetchedNarrativeTags(response, 'missing', () => undefined))
      .toEqual([{ predefined: false, label: 'Legacy' }])
  })

  it('applies fail-closed worker defaults when target configuration is absent', () => {
    expect(resolveNarrativeTagsWorkerSuggestions([
      { predefined: true, key: 'known', score: 0.9 },
      { predefined: false, label: 'Dynamic', score: 0.9 }
    ], null, () => undefined)).toEqual([])

    expect(buildNarrativeTagsWorkerPayload('Text', 'en', null, [])).toMatchObject({
      minScore: 1,
      maxSuggestions: 0,
      minDynamicScore: 1,
      maxDynamicTags: 0,
      allowDynamicTagSuggestions: false,
      useEmbeddingCache: false,
      useBrowserCache: false
    })
    expect(buildNarrativeTagsSuggestionWatchState(null, 'en', [], false, null)).toEqual({
      text: '',
      target: '',
      locale: 'en',
      keys: '',
      enabled: false,
      targetEnabled: false,
      targetCustom: false,
      targetDynamic: false,
      targetScore: 0,
      targetDynamicScore: 0,
      targetSuggestions: 0,
      targetDynamicTags: 0
    })
    expect(resolveKeywordFallbackSuggestions('Text', [], null)).toEqual([])
  })
})
