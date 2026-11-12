// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { TagsInputRoot, TagsInputItem, TagsInputItemText, TagsInputItemDelete, TagsInputInput } from 'reka-ui'
import type { Component } from 'vue'
import type { GcsAgreementDescriptionsExtensionContext } from '@gcs-ssc/extensions'
import NarrativeTagsSlot from '../../components/NarrativeTagsSlot.vue'
import { createNarrativeTagSourceProjection, normalizeNarrativeTagsConfig } from '../../components/narrative-tags'
import type { NarrativeTagSourceConfig, NarrativeTagValue } from '../../components/narrative-tags'
import { filterVisibleSourceTags } from '../../server/narrative-tags-route'

const setExtensionPayloadMock = vi.fn()

const mockFetchResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(body)
})

const stubApiFetch = (body: unknown) => {
  const fetchMock = vi.fn(async () => mockFetchResponse(body)) as unknown as typeof fetch
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const inputTagsStub = defineComponent({
  props: ['modelValue', 'placeholder'],
  emits: ['update:modelValue'],
  setup: (props, { emit, slots }) => () => h('div', { 'data-control': 'input-tags' }, [
    ...((props.modelValue as string[] | undefined) ?? []).map(item => h('span', { 'data-input-tag': item }, slots['item-text']?.({ item }) ?? item)),
    h('input', {
      placeholder: props.placeholder as string,
      value: (props.modelValue as string[] | undefined)?.join(',') ?? '',
      onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value.split(','))
    })
  ])
})

const actualTagsControl = defineComponent({
  props: ['modelValue'],
  emits: ['update:modelValue'],
  setup: (props, { emit }) => () => h(TagsInputRoot, {
    modelValue: props.modelValue,
    'onUpdate:modelValue': value => emit('update:modelValue', value)
  }, () => [
    ...(props.modelValue ?? []).map((item: string, index: number) => h(TagsInputItem, { value: item }, () => [
      h(TagsInputItemText),
      h(TagsInputItemDelete, { 'data-delete-index': index }, () => 'Remove')
    ])),
    h(TagsInputInput)
  ])
})

const mountSlot = (
  custom = false,
  extraConfig: Record<string, unknown> = {},
  context: Record<string, unknown> = {
    kind: 'agreement.descriptions',
    descriptions: {
      en: custom ? 'Training for staff.' : 'Funds equipment for a facility.',
      fr: custom ? 'Formation du personnel.' : 'Finance de l’équipement pour une installation.'
    },
    streamId: 'stream/31',
    agreementId: 'agreement 44',
    extensions: {},
    setExtensionPayload: setExtensionPayloadMock
  },
  inputTags: Component = inputTagsStub
) => mount(NarrativeTagsSlot, {
  props: {
    config: {
      enabled: true,
      allowCustomTags: custom,
      minScore: 0.1,
      maxSuggestions: 2,
      ...extraConfig,
      tags: [{
        key: custom ? 'capacity-building' : 'infrastructure',
        label: custom
          ? { en: 'Capacity building', fr: 'Renforcement des capacités' }
          : { en: 'Infrastructure', fr: 'Infrastructure' },
        description: custom
          ? { en: 'Training and skills', fr: 'Formation et compétences' }
          : { en: 'Facilities and equipment', fr: 'Installations et équipement' },
        aliases: custom ? ['training'] : ['capital project'],
        color: custom ? 'info' : 'neutral'
      }]
    },
    context
  },
  global: {
    stubs: {
      UBadge: defineComponent({
        props: ['color'],
        setup: (props, { slots }) => () => h('span', { 'data-badge-color': props.color as string }, slots.default?.())
      }),
      UButton: defineComponent({
        props: ['label'],
        emits: ['click'],
        setup: (props, { emit }) => () => h('button', {
          onClick: () => emit('click')
        }, String(props.label ?? ''))
      }),
      USelectMenu: defineComponent({
        props: ['items', 'placeholder', 'modelValue'],
        setup: (props, { slots }) => () => h('div', {
          'data-control': 'select-menu',
          'data-placeholder': props.placeholder as string,
          'data-items': JSON.stringify(props.items ?? [])
        }, slots.default?.({ modelValue: props.modelValue }) ?? [])
      }),
      UInputTags: inputTags
    }
  }
})

describe('NarrativeTagsSlot', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setExtensionPayloadMock.mockClear()
    delete (globalThis as typeof globalThis & { __gcsNarrativeTagsWorkerState?: unknown }).__gcsNarrativeTagsWorkerState
    vi.stubGlobal('useI18n', () => ({ locale: { value: 'en' } }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it.each([['en', false], ['fr', false], ['en', true], ['fr', true]] as const)(
    'associates the %s visible title with the custom=%s tag control',
    async (locale, custom) => {
      vi.stubGlobal('useI18n', () => ({ locale: { value: locale } }))
      stubApiFetch({ tags: [], sourceProjection: { version: 1, sourceKeys: [] } })
      vi.stubGlobal('Worker', class {
        addEventListener = vi.fn()
        postMessage = vi.fn()
      })
      const wrapper = mountSlot(custom)
      await vi.runOnlyPendingTimersAsync()
      const control = wrapper.find(`[data-control="${custom ? 'input-tags' : 'select-menu'}"]`)
      const labelId = control.attributes('aria-labelledby')
      expect(labelId).toBeTruthy()
      expect(wrapper.findAll('[id]').find(label => label.attributes('id') === labelId)?.text())
        .toBe(locale === 'fr' ? 'Étiquettes suggérées' : 'Suggested tags')
    }
  )

  it('encodes route identifiers before loading persisted tags', async () => {
    const fetchMock = stubApiFetch({ tags: [{ predefined: true, key: 'infrastructure', label: 'Infrastructure' }] })
    vi.stubGlobal('Worker', class {
      addEventListener = vi.fn()
      postMessage = vi.fn()
    })

    mountSlot()
    await vi.runAllTimersAsync()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/extensions/gcs-narrative-tags/streams/stream%2F31/agreements/agreement%2044/tags',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('renders the controlled predefined dropdown without a separate save button', async () => {
    stubApiFetch({ tags: [], sourceProjection: { version: 1, sourceKeys: [] } })
    vi.stubGlobal('Worker', class {
      addEventListener = vi.fn()
      postMessage = vi.fn()
    })

    const wrapper = mountSlot()
    await vi.runOnlyPendingTimersAsync()

    expect(wrapper.find('[data-control="select-menu"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Save tags')
  })

  it('hydrates valid embedded predefined and custom tags without fetching an unsaved Agreement', async () => {
    const fetchMock = stubApiFetch({ tags: [], sourceProjection: { version: 1, sourceKeys: [] } })
    vi.stubGlobal('Worker', class { addEventListener = vi.fn(); postMessage = vi.fn() })
    const source = { agencyId: 'agency-1', agencyName: { en: 'Agency', fr: 'Agence' } }
    const known = { predefined: true, key: 'infrastructure', label: 'Previously authored label', source }
    const custom = { predefined: false, label: 'Local priority', source }
    const wrapper = mountSlot(false, {}, {
      kind: 'agreement.descriptions', descriptions: { en: 'Infrastructure project', fr: '' }, streamId: 'stream-1',
      extensions: {
        'gcs-narrative-tags': { textFieldTags: { 'agreement.description': [
          known,
          { predefined: true, key: 'unavailable', label: 'Unavailable', source },
          custom
        ] } }
      },
      setExtensionPayload: setExtensionPayloadMock
    })
    try {
      await flushPromises()
      expect(fetchMock).not.toHaveBeenCalled()
      expect(setExtensionPayloadMock).toHaveBeenCalledWith('gcs-narrative-tags', 'agreementDescriptionTags', [known, custom])
      expect(setExtensionPayloadMock).toHaveBeenCalledWith('gcs-narrative-tags', 'textFieldTags', {
        'agreement.description': [known, custom]
      })
      expect(wrapper.get('[data-control="select-menu"]').text()).toContain('Infrastructure - Agency')
      expect(wrapper.get('[data-control="select-menu"]').text()).toContain('Local priority - Agency')
      expect(wrapper.get('[data-control="select-menu"]').text()).not.toContain('Unavailable')
    } finally {
      wrapper.unmount()
    }
  })

  it('retains a natively authored predefined choice when the unsaved Agreement slot remounts', async () => {
    const fetchMock = stubApiFetch({ tags: [], sourceProjection: { version: 1, sourceKeys: [] } })
    vi.stubGlobal('Worker', class { addEventListener = vi.fn(); postMessage = vi.fn() })
    const extensions: Record<string, Record<string, unknown>> = {}
    const context = {
      kind: 'agreement.descriptions', descriptions: { en: 'Training staff', fr: '' }, streamId: 'stream-1', extensions,
      setExtensionPayload: (extensionKey: string, field: string, value: unknown) => {
        extensions[extensionKey] = { ...extensions[extensionKey], [field]: value }
      }
    }
    const first = mountSlot(true, {}, context)
    await flushPromises()
    await first.get('[data-control="input-tags"] input').setValue('Capacity building,Local priority')
    const authored = [
      { predefined: true, key: 'capacity-building', label: 'Capacity building', source: undefined },
      { predefined: false, label: 'Local priority', source: undefined }
    ]
    expect(extensions['gcs-narrative-tags']?.agreementDescriptionTags).toEqual(authored)
    first.unmount()
    const replacement = mountSlot(true, {}, context)
    try {
      await flushPromises()
      expect(fetchMock).not.toHaveBeenCalled()
      expect(replacement.get<HTMLInputElement>('input').element.value).toBe('Capacity building,Local priority')
      expect(extensions['gcs-narrative-tags']?.agreementDescriptionTags).toEqual(authored)
    } finally {
      replacement.unmount()
    }
  })

  it.each([
    ['en', true, false], ['fr', true, false], ['en', false, false], ['fr', false, false],
    ['en', true, true], ['fr', true, true], ['en', false, true], ['fr', false, true]
  ])('preserves the remaining sourced tag through the installed chip Delete in %s (custom=%s, equal display=%s)', async (locale, custom, equalDisplay) => {
    vi.stubGlobal('useI18n', () => ({ locale: { value: locale } }))
    vi.stubGlobal('Worker', class { addEventListener = vi.fn(); postMessage = vi.fn() })
    const sourceA = {
      agencyId: '1', agencyName: { en: 'Agency One', fr: 'Agence Un' },
      streamId: '11', streamName: { en: 'Stream One', fr: 'Volet Un' }
    }
    const sourceB = {
      agencyId: '2', agencyName: equalDisplay ? sourceA.agencyName : { en: 'Agency Two', fr: 'Agence Deux' },
      streamId: '21', streamName: equalDisplay ? sourceA.streamName : { en: 'Stream Two', fr: 'Volet Deux' }
    }
    const value = (source: typeof sourceA): NarrativeTagValue => custom
      ? { predefined: false, label: 'Same authored label', source }
      : { predefined: true, key: 'priority', label: 'Priority', source }
    const removed = value(sourceA)
    const retained = value(sourceB)
    const config = normalizeNarrativeTagsConfig({
      enabled: true,
      allowCustomTags: true,
      tags: [{ key: 'priority', label: { en: 'Priority', fr: 'Priorité' } }]
    })
    stubApiFetch({
      tags: [removed, retained],
      sources: [{ source: sourceA, config }, { source: sourceB, config }],
      sourceProjection: createNarrativeTagSourceProjection([{ source: sourceA }, { source: sourceB }])
    })
    const wrapper = mountSlot(true, {}, {
      kind: 'proponent.descriptions', descriptions: { en: 'Ordinary profile correction', fr: '' },
      applicantRecipientId: '99', agencies: [{ agencyId: '1' }, { agencyId: '2' }], extensions: {},
      setExtensionPayload: setExtensionPayloadMock
    }, actualTagsControl)
    try {
      await flushPromises()
      expect(setExtensionPayloadMock).toHaveBeenLastCalledWith('gcs-narrative-tags', 'textFieldTags', {
        'proponent.description': [removed, retained]
      })
      await wrapper.get('[data-delete-index="0"]').trigger('click')
      await flushPromises()
      expect(setExtensionPayloadMock).toHaveBeenLastCalledWith('gcs-narrative-tags', 'textFieldTags', {
        'proponent.description': [retained]
      })
      if (custom && locale === 'en') {
        await wrapper.get('input').setValue('New custom tag')
        await wrapper.get('input').trigger('keydown', { key: 'Enter' })
        await flushPromises()
        expect(setExtensionPayloadMock).toHaveBeenLastCalledWith('gcs-narrative-tags', 'textFieldTags', {
          'proponent.description': [retained, { predefined: false, label: 'New custom tag', source: sourceA }]
        })
      }
    } finally {
      wrapper.unmount()
    }
  })

  it('continues filtering persisted predefined keys from disabled Proponent sources while preserving custom source identity', async () => {
    const enabledSource = { agencyId: 'enabled-agency' }
    const disabledSource = { agencyId: 'disabled-agency' }
    const custom = { predefined: false, label: 'Local priority', source: disabledSource }
    const enabled = { predefined: true, key: 'infrastructure', label: 'Infrastructure', source: enabledSource }
    const definition = (key: string) => ({ key, label: { en: key, fr: key }, description: { en: '', fr: '' }, aliases: [], color: 'neutral' })
    stubApiFetch({
      tags: [enabled, { predefined: true, key: 'disabled-key', label: 'Disabled', source: disabledSource }, custom],
      sourceProjection: createNarrativeTagSourceProjection([{ source: enabledSource }, { source: disabledSource }]),
      sources: [
        { source: enabledSource, config: { enabled: true, tags: [definition('infrastructure')] } },
        { source: disabledSource, config: { enabled: false, tags: [definition('disabled-key')] } }
      ]
    })
    vi.stubGlobal('Worker', class { addEventListener = vi.fn(); postMessage = vi.fn() })
    const wrapper = mountSlot(false, {}, {
      kind: 'proponent.descriptions', descriptions: { en: 'Infrastructure project', fr: '' },
      applicantRecipientId: 'proponent-1', agencies: [{ agencyId: 'agency-1' }], extensions: {},
      setExtensionPayload: setExtensionPayloadMock
    })
    try {
      await flushPromises()
      expect(setExtensionPayloadMock).toHaveBeenLastCalledWith('gcs-narrative-tags', 'textFieldTags', {
        'proponent.description': [enabled, custom]
      })
      expect(wrapper.get('[data-control="select-menu"]').attributes('data-items')).not.toContain('disabled-key')
    } finally {
      wrapper.unmount()
    }
  })

  it.each(['target-disabled', 'disabled', 'missing', 'hidden', 'empty'])(
    'does not revive a %s explicit source through another source with the same key',
    async availability => {
      const activeSource = { agencyId: '1', streamId: '10', streamName: { en: 'Active', fr: 'Active' } }
      const unavailableSource = { agencyId: '1', streamId: '11', streamName: { en: 'Unavailable', fr: 'Indisponible' } }
      const sourceConfig = (source: typeof activeSource, label: string): NarrativeTagSourceConfig => ({
        source,
        config: normalizeNarrativeTagsConfig({ enabled: true, tags: [{
          key: 'infrastructure', label: { en: label, fr: label },
          description: { en: '', fr: '' }, aliases: [], color: 'neutral'
        }] })
      })
      const active = sourceConfig(activeSource, 'Active source label')
      const unavailable = sourceConfig(unavailableSource, 'Original source label')
      if (availability === 'target-disabled') unavailable.config.targets['proponent.description'].enabled = false
      if (availability === 'disabled') unavailable.config.enabled = false
      const sources = availability === 'empty'
        ? []
        : availability === 'missing' || availability === 'hidden' ? [active] : [active, unavailable]
      const original: NarrativeTagValue = {
        predefined: true, key: 'infrastructure', label: 'Original source label', source: unavailableSource
      }
      const custom: NarrativeTagValue = { predefined: false, label: 'Local priority', source: unavailableSource }
      const stored = { 'proponent.description': [original, custom] }
      const textFieldTags = availability === 'hidden' ? filterVisibleSourceTags(sources, stored) : stored
      if (availability === 'target-disabled' || availability === 'disabled') {
        expect(filterVisibleSourceTags(sources, stored)).toEqual(stored)
      }
      stubApiFetch({ tags: textFieldTags['proponent.description'], textFieldTags, sources, sourceProjection: createNarrativeTagSourceProjection(sources) })
      vi.stubGlobal('Worker', class { addEventListener = vi.fn(); postMessage = vi.fn() })
      const wrapper = mountSlot(false, {}, {
        kind: 'proponent.descriptions', descriptions: { en: 'Infrastructure project', fr: '' },
        applicantRecipientId: '1', agencies: [{ agencyId: '1' }], extensions: {},
        setExtensionPayload: setExtensionPayloadMock
      })
      try {
        await flushPromises()
        expect(setExtensionPayloadMock).toHaveBeenLastCalledWith('gcs-narrative-tags', 'textFieldTags', {
          'proponent.description': availability === 'hidden' ? [] : [custom]
        })
        const control = wrapper.get('[data-control="select-menu"]')
        expect(control.text()).not.toContain('Original source label')
        expect(control.text()).not.toContain('Active source label')
        if (availability !== 'hidden') expect(control.text()).toContain('Local priority - 1 / Unavailable')
        expect(stored['proponent.description']).toEqual([original, custom])
      } finally {
        wrapper.unmount()
      }
    }
  )

  it.each([false, true])('localizes duplicate source keys independently in custom=%s mode', async custom => {
    const locale = ref('en')
    vi.stubGlobal('useI18n', () => ({ locale }))
    const sources: NarrativeTagSourceConfig[] = ['10', '11'].map(streamId => ({
      source: { agencyId: '1', streamId, streamName: { en: `Stream ${streamId}`, fr: `Volet ${streamId}` } },
      config: normalizeNarrativeTagsConfig({ enabled: true, allowCustomTags: custom, tags: [{
        key: 'infrastructure', label: { en: `English ${streamId}`, fr: `Français ${streamId}` },
        description: { en: '', fr: '' }, aliases: [], color: 'neutral'
      }] })
    }))
    const tags: NarrativeTagValue[] = sources.flatMap(({ source }) => [
      { predefined: true, key: 'infrastructure', label: `Saved ${source.streamId}`, source },
      { predefined: false, label: 'Local priority', source }
    ])
    stubApiFetch({ tags, sources, sourceProjection: createNarrativeTagSourceProjection(sources) })
    vi.stubGlobal('Worker', class { addEventListener = vi.fn(); postMessage = vi.fn() })
    const wrapper = mountSlot(false, {}, {
      kind: 'proponent.descriptions', descriptions: { en: 'Infrastructure project', fr: '' },
      applicantRecipientId: '1', agencies: [{ agencyId: '1' }], extensions: {},
      setExtensionPayload: setExtensionPayloadMock
    })
    try {
      await flushPromises()
      const control = wrapper.get(`[data-control="${custom ? 'input-tags' : 'select-menu'}"]`)
      expect(control.text()).toContain('English 10 - 1 / Stream 10')
      expect(control.text()).toContain('English 11 - 1 / Stream 11')
      expect(control.text()).toContain('Local priority - 1 / Stream 10')
      expect(control.text()).toContain('Local priority - 1 / Stream 11')
      expect(setExtensionPayloadMock).toHaveBeenLastCalledWith('gcs-narrative-tags', 'textFieldTags', {
        'proponent.description': tags
      })
      setExtensionPayloadMock.mockClear()
      locale.value = 'fr'
      await wrapper.vm.$nextTick()
      expect(control.text()).toContain('Français 10 - 1 / Volet 10')
      expect(control.text()).toContain('Français 11 - 1 / Volet 11')
      expect(setExtensionPayloadMock).not.toHaveBeenCalled()
    } finally {
      wrapper.unmount()
    }
  })

  it('keeps bare fetched predefined tags compatible with a source-scoped vocabulary', async () => {
    const source = { agencyId: '1', streamId: '10' }
    const tags: NarrativeTagValue[] = [{ predefined: true, key: 'infrastructure', label: 'Legacy saved label' }]
    stubApiFetch({ tags, sources: [{ source, config: normalizeNarrativeTagsConfig({ enabled: true }) }], sourceProjection: createNarrativeTagSourceProjection([{ source }]) })
    vi.stubGlobal('Worker', class { addEventListener = vi.fn(); postMessage = vi.fn() })
    const wrapper = mountSlot(false, {}, {
      kind: 'proponent.descriptions', descriptions: { en: 'Infrastructure project', fr: '' },
      applicantRecipientId: '1', agencies: [{ agencyId: '1' }], extensions: {},
      setExtensionPayload: setExtensionPayloadMock
    })
    try {
      await flushPromises()
      expect(wrapper.get('[data-control="select-menu"]').text()).toContain('Infrastructure')
      expect(setExtensionPayloadMock).toHaveBeenLastCalledWith('gcs-narrative-tags', 'textFieldTags', {
        'proponent.description': tags
      })
    } finally {
      wrapper.unmount()
    }
  })

  it('renders selected predefined tags with a consistent neutral color', async () => {
    stubApiFetch({
      tags: [{ predefined: true, key: 'infrastructure', label: 'Infrastructure' }]
    })
    vi.stubGlobal('Worker', class {
      addEventListener = vi.fn()
      postMessage = vi.fn()
    })

    const wrapper = mountSlot()
    await vi.runOnlyPendingTimersAsync()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-badge-color="neutral"]').text()).toContain('Infrastructure')
  })

  it.each([false, true])('localizes stored predefined labels in custom=%s mode without rewriting stored tags', async custom => {
    const locale = ref('en')
    vi.stubGlobal('useI18n', () => ({ locale }))
    const tags = [
      { predefined: true, key: 'capacity-building', label: 'Previously saved label' },
      { predefined: false, label: 'Texte personnel' }
    ]
    stubApiFetch({ tags })
    vi.stubGlobal('Worker', class {
      addEventListener = vi.fn()
      postMessage = vi.fn()
    })
    const wrapper = mountSlot(true, {
      allowCustomTags: custom
    })
    await vi.runOnlyPendingTimersAsync()
    await wrapper.vm.$nextTick()
    const control = custom ? '[data-control="input-tags"]' : '[data-control="select-menu"]'
    expect(wrapper.get(control).text()).toContain('Capacity building')
    expect(wrapper.get(control).text()).toContain('Texte personnel')
    setExtensionPayloadMock.mockClear()

    locale.value = 'fr'
    await wrapper.vm.$nextTick()

    expect(wrapper.get(control).text()).toContain('Renforcement des capacités')
    expect(wrapper.get(control).text()).toContain('Texte personnel')
    expect(wrapper.get(control).text()).not.toContain('Previously saved label')
    expect(setExtensionPayloadMock).not.toHaveBeenCalled()
    expect(tags[0]?.label).toBe('Previously saved label')
  })

  it('uses animated loading dots without duplicating the suggested tags label', async () => {
    stubApiFetch({ tags: [], sourceProjection: { version: 1, sourceKeys: [] } })
    vi.stubGlobal('Worker', class {
      addEventListener = vi.fn()
      postMessage = vi.fn()
    })

    const wrapper = mountSlot()

    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    expect(wrapper.text().match(/Suggested tags/g)).toHaveLength(1)
  })

  it('renders input tags for custom mode and writes typed custom tags to the agreement payload', async () => {
    stubApiFetch({ tags: [], sourceProjection: { version: 1, sourceKeys: [] } })
    vi.stubGlobal('Worker', class {
      addEventListener = vi.fn()
      postMessage = vi.fn()
    })

    const wrapper = mountSlot(true)
    await vi.runOnlyPendingTimersAsync()
    await wrapper.find('[data-control="input-tags"] input').setValue('Local priority')

    expect(setExtensionPayloadMock).toHaveBeenCalledWith('gcs-narrative-tags', 'agreementDescriptionTags', [
      { predefined: false, label: 'Local priority' }
    ])
  })

  it('adds suggestion clicks as predefined typed tags in the agreement payload', async () => {
    stubApiFetch({ tags: [], sourceProjection: { version: 1, sourceKeys: [] } })
    vi.stubGlobal('Worker', class {
      addEventListener = vi.fn()
      postMessage = vi.fn(() => {
        const state = (globalThis as typeof globalThis & {
          __gcsNarrativeTagsWorkerState: {
            requestId: number
            listeners: Set<(message: unknown) => void>
          }
        }).__gcsNarrativeTagsWorkerState
        for (const listener of state.listeners) {
          listener({
            kind: 'result',
            requestId: state.requestId - 1,
            suggestions: [{ key: 'capacity-building', score: 0.9 }]
          })
        }
      })
    })

    const wrapper = mountSlot(true)
    await vi.runAllTimersAsync()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.find('button').trigger('click')
    await wrapper.vm.$nextTick()

    expect(setExtensionPayloadMock).toHaveBeenCalledWith('gcs-narrative-tags', 'agreementDescriptionTags', [
      { predefined: true, key: 'capacity-building', label: 'Capacity building' }
    ])
    expect(wrapper.find('[data-control="input-tags"]').text()).toContain('Capacity building')
    expect(wrapper.find('.agreement-tag-input__predefined').exists()).toBe(true)
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('adds dynamic suggestions as custom typed tags when custom tags are enabled', async () => {
    stubApiFetch({ tags: [], sourceProjection: { version: 1, sourceKeys: [] } })
    vi.stubGlobal('Worker', class {
      addEventListener = vi.fn()
      postMessage = vi.fn()
    })

    const wrapper = mountSlot(true, {
      allowDynamicTagSuggestions: true,
      minDynamicScore: 0.1
    })
    await vi.runAllTimersAsync()
    const state = (globalThis as typeof globalThis & {
      __gcsNarrativeTagsWorkerState: {
        requestId: number
        listeners: Set<(message: unknown) => void>
      }
    }).__gcsNarrativeTagsWorkerState
    for (const listener of state.listeners) {
      listener({
        kind: 'result',
        requestId: state.requestId - 1,
        suggestions: [{ predefined: false, label: 'staff-training', score: 0.9 }]
      })
    }
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    const dynamicButton = wrapper.findAll('button').find(button => button.text().includes('staff-training'))
    expect(dynamicButton).toBeTruthy()
    await dynamicButton?.trigger('click')
    await wrapper.vm.$nextTick()

    expect(setExtensionPayloadMock).toHaveBeenCalledWith('gcs-narrative-tags', 'agreementDescriptionTags', [
      { predefined: false, label: 'staff-training' }
    ])
    expect(wrapper.find('[data-control="input-tags"]').text()).toContain('staff-training')
  })

  it('persists proponent description tags as one entity-level text field payload', async () => {
    stubApiFetch({ tags: [], sourceProjection: { version: 1, sourceKeys: [] } })
    vi.stubGlobal('Worker', class {
      addEventListener = vi.fn()
      postMessage = vi.fn()
    })

    const wrapper = mountSlot(true, {}, {
      kind: 'proponent.descriptions',
      descriptions: {
        en: 'Community training for local applicants.',
        fr: 'Formation communautaire pour les demandeurs locaux.'
      },
      agencies: [{ agencyId: 'agency/1', nameEn: 'First', nameFr: 'Première', config: {} }],
      applicantRecipientId: 'recipient 2',
      extensions: {},
      setExtensionPayload: setExtensionPayloadMock
    })
    await vi.runOnlyPendingTimersAsync()
    await wrapper.find('[data-control="input-tags"] input').setValue('Local priority')

    expect(setExtensionPayloadMock).toHaveBeenCalledWith('gcs-narrative-tags', 'textFieldTags', {
      'proponent.description': [{ predefined: false, label: 'Local priority' }]
    })
    expect(setExtensionPayloadMock).not.toHaveBeenCalledWith('gcs-narrative-tags', 'agreementDescriptionTags', expect.anything())
  })

  it('does not contribute a replacement selection when the Proponent GET lacks its required projection', async () => {
    stubApiFetch({ tags: [] })
    vi.stubGlobal('Worker', class { addEventListener = vi.fn(); postMessage = vi.fn() })
    const wrapper = mountSlot(true, {}, {
      kind: 'proponent.descriptions', descriptions: { en: 'Current profile', fr: '' },
      applicantRecipientId: '99', agencies: [{ agencyId: '1' }], extensions: {},
      setExtensionPayload: setExtensionPayloadMock
    })
    try {
      await flushPromises()
      await wrapper.get('input').setValue('Local priority')
      expect(setExtensionPayloadMock).toHaveBeenCalledWith('gcs-narrative-tags', 'proponentSourceProjection', null)
      expect(setExtensionPayloadMock).not.toHaveBeenCalledWith('gcs-narrative-tags', 'textFieldTags', expect.anything())
      await flushPromises()
      expect(wrapper.find('[data-badge-color="warning"]').exists()).toBe(true)
    } finally { wrapper.unmount() }
  })

  it('loads Proponent tag choices from every eligible agency without choosing one', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const second = url.includes('agency%2F2')
      const agencyId = second ? 'agency/2' : 'agency/1'
      const key = second ? 'capacity-building' : 'infrastructure'
      const label = second ? 'Capacity building' : 'Infrastructure'
      return mockFetchResponse({
        tags: [],
        sourceProjection: { version: 1, sourceKeys: [`${agencyId}:agency`] },
        sources: [{
          source: { agencyId, agencyName: { en: second ? 'Second' : 'First', fr: second ? 'Deuxième' : 'Première' } },
          config: {
            enabled: true,
            tags: [{ key, label: { en: label, fr: label }, description: { en: '', fr: '' }, aliases: [], color: 'neutral' }]
          }
        }]
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('Worker', class {
      addEventListener = vi.fn()
      postMessage = vi.fn()
    })

    const wrapper = mountSlot(false, {}, {
      kind: 'proponent.descriptions',
      descriptions: { en: 'Training and infrastructure', fr: 'Formation et infrastructure' },
      applicantRecipientId: 'recipient 2',
      agencies: [
        { agencyId: 'agency/1', nameEn: 'First', nameFr: 'Première', config: {} },
        { agencyId: 'agency/2', nameEn: 'Second', nameFr: 'Deuxième', config: {} }
      ],
      extensions: {},
      setExtensionPayload: setExtensionPayloadMock
    })
    await vi.runAllTimersAsync()
    await wrapper.vm.$nextTick()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/extensions/gcs-narrative-tags/agencies/agency%2F1/applicant-recipients/recipient%202/tags',
      expect.objectContaining({ method: 'GET' })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/extensions/gcs-narrative-tags/agencies/agency%2F2/applicant-recipients/recipient%202/tags',
      expect.objectContaining({ method: 'GET' })
    )
    const options = wrapper.get('[data-control="select-menu"]').attributes('data-items')
    expect(options).toContain('Infrastructure')
    expect(options).toContain('Capacity building')
  })

  it('falls back to keyword ranking when the browser cannot create the worker', async () => {
    stubApiFetch({ tags: [], sourceProjection: { version: 1, sourceKeys: [] } })
    vi.stubGlobal('Worker', class {
      constructor() {
        throw new Error('worker blocked')
      }
    })

    const wrapper = mountSlot()
    await vi.runOnlyPendingTimersAsync()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Tag suggestions unavailable')
    expect(wrapper.find('button').exists()).toBe(true)
  })

  it('falls back and resets the shared worker after an asynchronous worker failure', async () => {
    stubApiFetch({ tags: [], sourceProjection: { version: 1, sourceKeys: [] } })
    const listeners = new Map<string, () => void>()
    const terminateMock = vi.fn()
    vi.stubGlobal('Worker', class {
      addEventListener(type: string, handler: () => void) {
        listeners.set(type, handler)
      }

      postMessage() {}

      terminate() {
        terminateMock()
      }
    })

    const wrapper = mountSlot()
    await vi.runAllTimersAsync()
    listeners.get('messageerror')?.()
    await wrapper.vm.$nextTick()

    expect(terminateMock).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('Tag suggestions unavailable')
    expect(wrapper.find('button').exists()).toBe(true)
    expect((globalThis as any).__gcsNarrativeTagsWorkerState.lifecycle.kind).toBe('failed')
  })

  it('rejects a previous target worker result during replacement debounce and after disable', async () => {
    stubApiFetch({ tags: [], sourceProjection: { version: 1, sourceKeys: [] } })
    const requests: { requestId: number }[] = []
    const workerMessages: ((event: { data: unknown }) => void)[] = []
    vi.stubGlobal('Worker', class {
      addEventListener(type: string, listener: (event: { data: unknown }) => void) {
        if (type === 'message') workerMessages.push(listener)
      }
      postMessage(request: { requestId: number }) { requests.push(request) }
    })
    const wrapper = mountSlot()
    await vi.runAllTimersAsync()
    const firstRequest = requests[0]!
    await wrapper.setProps({ context: {
      kind: 'agreement.descriptions', streamId: 'stream/31', agreementId: 'replacement',
      descriptions: { en: 'Funds equipment for a facility.', fr: 'Équipement' },
      extensions: {}, setExtensionPayload: setExtensionPayloadMock
    } })
    for (const listener of workerMessages) listener({ data: {
      kind: 'result', requestId: firstRequest.requestId,
      suggestions: [{ key: 'infrastructure', score: 0.99 }]
    } })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    await vi.runAllTimersAsync()
    const currentRequest = requests.at(-1)!
    await wrapper.setProps({ config: { enabled: false, tags: [] } })
    for (const listener of workerMessages) listener({ data: {
      kind: 'result', requestId: currentRequest.requestId,
      suggestions: [{ key: 'infrastructure', score: 0.99 }]
    } })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-field-scope]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('clears accepted suggestions immediately when the subject changes', async () => {
    stubApiFetch({ tags: [], sourceProjection: { version: 1, sourceKeys: [] } })
    let message: ((event: { data: unknown }) => void) | undefined
    let requestId = 0
    vi.stubGlobal('Worker', class {
      addEventListener(type: string, listener: (event: { data: unknown }) => void) {
        if (type === 'message') message = listener
      }
      postMessage(request: { requestId: number }) { requestId = request.requestId }
    })
    const wrapper = mountSlot()
    await vi.runAllTimersAsync()
    message?.({ data: { kind: 'result', requestId, suggestions: [{ key: 'infrastructure', score: 0.99 }] } })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('button').exists()).toBe(true)
    await wrapper.setProps({ context: {
      kind: 'agreement.descriptions', streamId: 'stream/31', agreementId: 'replacement',
      descriptions: { en: 'Funds equipment for a facility.', fr: 'Équipement' },
      extensions: {}, setExtensionPayload: setExtensionPayloadMock
    } })
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('never applies persisted tags from a replaced subject or after disposal', async () => {
    const pending: ((response: ReturnType<typeof mockFetchResponse>) => void)[] = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => pending.push(resolve))))
    vi.stubGlobal('Worker', class {
      addEventListener = vi.fn()
      postMessage = vi.fn()
    })
    const wrapper = mountSlot()
    await wrapper.setProps({ context: {
      kind: 'agreement.descriptions', streamId: 'stream/31', agreementId: 'replacement',
      descriptions: { en: 'New subject', fr: 'Nouveau' },
      extensions: {}, setExtensionPayload: setExtensionPayloadMock
    } })
    pending[1]!(mockFetchResponse({ tags: [{ predefined: false, label: 'Current evidence' }] }))
    await flushPromises()
    expect(wrapper.get('[data-control="select-menu"]').text()).toContain('Current evidence')
    pending[0]!(mockFetchResponse({ tags: [{ predefined: false, label: 'Previous evidence' }] }))
    await flushPromises()
    expect(wrapper.get('[data-control="select-menu"]').text()).not.toContain('Previous evidence')
    await wrapper.setProps({ context: {
      kind: 'agreement.descriptions', streamId: 'stream/31', agreementId: 'third',
      descriptions: { en: 'Third subject', fr: 'Troisième' },
      extensions: {}, setExtensionPayload: setExtensionPayloadMock
    } })
    wrapper.unmount()
    setExtensionPayloadMock.mockClear()
    pending[2]!(mockFetchResponse({ tags: [{ predefined: false, label: 'Disposed evidence' }] }))
    await flushPromises()
    expect(setExtensionPayloadMock).not.toHaveBeenCalled()
  })

  it('merges persisted tags with edits made while hydration is pending without writing an incomplete payload', async () => {
    let settle: ((response: ReturnType<typeof mockFetchResponse>) => void) | undefined
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { settle = resolve })))
    vi.stubGlobal('Worker', class { addEventListener = vi.fn(); postMessage = vi.fn() })
    const wrapper = mountSlot(true)

    await wrapper.find('input').setValue('Discarded draft')
    await wrapper.find('input').setValue('Capacity building,Local priority')
    expect(setExtensionPayloadMock).not.toHaveBeenCalled()

    settle!(mockFetchResponse({ tags: [
      { predefined: false, label: 'Previously saved' },
      { predefined: true, key: 'capacity-building', label: 'Capacity building' }
    ] }))
    await flushPromises()

    expect(wrapper.findAll('[data-input-tag]').map(tag => tag.attributes('data-input-tag')))
      .toEqual(['Previously saved', 'Capacity building', 'Local priority'])
    expect(setExtensionPayloadMock).toHaveBeenLastCalledWith('gcs-narrative-tags', 'agreementDescriptionTags', [
      { predefined: false, label: 'Previously saved' },
      { predefined: true, key: 'capacity-building', label: 'Capacity building' },
      { predefined: false, label: 'Local priority' }
    ])
    wrapper.unmount()
  })

  it.each(['agreement.descriptions', 'proponent.descriptions'] as const)(
    'preserves unsaved %s tags while replacing narrative text, including a temporary blank',
    async kind => {
      const fetchMock = stubApiFetch({ tags: [], sourceProjection: { version: 1, sourceKeys: [] } })
      vi.stubGlobal('Worker', class { addEventListener = vi.fn(); postMessage = vi.fn() })
      const context = {
        kind,
        descriptions: { en: 'Original narrative', fr: '' },
        streamId: 'stream-1',
        agreementId: 'agreement-1',
        applicantRecipientId: 'proponent-1',
        agencies: [{ agencyId: 'agency-1', nameEn: 'Agency', nameFr: 'Agence', config: {} }],
        extensions: {},
        setExtensionPayload: setExtensionPayloadMock
      }
      const wrapper = mountSlot(true, {}, context)
      try {
        await flushPromises()
        await wrapper.get('input').setValue('Local priority')
        await wrapper.setProps({ context: { ...context, descriptions: { en: 'Edited narrative', fr: '' } } })
        await flushPromises()
        expect(wrapper.get<HTMLInputElement>('input').element.value).toBe('Local priority')
        await wrapper.setProps({ context: { ...context, descriptions: { en: '', fr: '' } } })
        expect(wrapper.find('input').exists()).toBe(false)
        expect(wrapper.find('[role="status"]').exists()).toBe(false)
        await wrapper.setProps({ context: { ...context, descriptions: { en: 'Replacement narrative', fr: '' } } })
        await flushPromises()
        expect(wrapper.get<HTMLInputElement>('input').element.value).toBe('Local priority')
        expect(fetchMock).toHaveBeenCalledTimes(1)
      } finally {
        wrapper.unmount()
      }
    }
  )

  it('hydrates an initially blank narrative owner without starting suggestions or replacing its tags on first input', async () => {
    const fetchMock = stubApiFetch({ tags: [{ predefined: false, label: 'Previously saved' }] })
    const postMessage = vi.fn()
    vi.stubGlobal('Worker', class { addEventListener = vi.fn(); postMessage = postMessage })
    const context = {
      kind: 'agreement.descriptions', descriptions: { en: '', fr: '' },
      streamId: 'stream-1', agreementId: 'agreement-1', extensions: {},
      setExtensionPayload: setExtensionPayloadMock
    } satisfies GcsAgreementDescriptionsExtensionContext
    const wrapper = mountSlot(true, {}, context)
    try {
      await flushPromises()
      await vi.runOnlyPendingTimersAsync()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(postMessage).not.toHaveBeenCalled()
      expect(wrapper.find('input').exists()).toBe(false)

      await wrapper.setProps({ context: { ...context, descriptions: { en: 'First narrative', fr: '' } } })
      await flushPromises()
      expect(wrapper.get<HTMLInputElement>('input').element.value).toBe('Previously saved')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      wrapper.unmount()
    }
  })

  it('retains the pending draft after hydration fails without automatically replacing unknown saved tags', async () => {
    let reject: ((reason: Error) => void) | undefined
    vi.stubGlobal('fetch', vi.fn(() => new Promise((_resolve, rejectRequest) => { reject = rejectRequest })))
    vi.stubGlobal('Worker', class { addEventListener = vi.fn(); postMessage = vi.fn() })
    const wrapper = mountSlot(true)
    await wrapper.find('input').setValue('Local priority')

    reject!(new Error('Unavailable'))
    await flushPromises()

    expect(wrapper.find('[data-input-tag="Local priority"]').exists()).toBe(true)
    expect(wrapper.find('[data-badge-color="warning"]').exists()).toBe(true)
    expect(setExtensionPayloadMock).not.toHaveBeenCalled()

    await wrapper.find('input').setValue('Local priority,Explicit followup')
    expect(setExtensionPayloadMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-input-tag="Local priority"]').exists()).toBe(true)
    expect(wrapper.find('[data-input-tag="Explicit followup"]').exists()).toBe(true)
    reject?.(new Error('Retry unavailable'))
    await flushPromises()
    expect(wrapper.find('[data-badge-color="warning"]').exists()).toBe(true)
    expect(setExtensionPayloadMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('never merges a previous subject draft or late response into the replacement subject', async () => {
    const pending: ((response: ReturnType<typeof mockFetchResponse>) => void)[] = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => pending.push(resolve))))
    vi.stubGlobal('Worker', class { addEventListener = vi.fn(); postMessage = vi.fn() })
    const wrapper = mountSlot(true)
    await wrapper.find('input').setValue('Previous draft')
    await wrapper.setProps({ context: {
      kind: 'agreement.descriptions', streamId: 'stream/31', agreementId: 'replacement',
      descriptions: { en: 'New subject', fr: 'Nouveau' }, extensions: {},
      setExtensionPayload: setExtensionPayloadMock
    } })
    await wrapper.find('input').setValue('Replacement draft')
    pending[0]!(mockFetchResponse({ tags: [{ predefined: false, label: 'Previous saved' }] }))
    await flushPromises()
    expect(setExtensionPayloadMock).not.toHaveBeenCalled()
    pending[1]!(mockFetchResponse({ tags: [{ predefined: false, label: 'Replacement saved' }] }))
    await flushPromises()

    expect(wrapper.findAll('[data-input-tag]').map(tag => tag.attributes('data-input-tag')))
      .toEqual(['Replacement saved', 'Replacement draft'])
    expect(setExtensionPayloadMock).toHaveBeenLastCalledWith('gcs-narrative-tags', 'agreementDescriptionTags', [
      { predefined: false, label: 'Replacement saved' },
      { predefined: false, label: 'Replacement draft' }
    ])
    wrapper.unmount()
  })
})
