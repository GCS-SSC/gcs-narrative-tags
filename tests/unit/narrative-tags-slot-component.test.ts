// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import NarrativeTagsSlot from '../../components/NarrativeTagsSlot.vue'

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
  }
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
      UInputTags: inputTagsStub
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
      stubApiFetch({ tags: [] })
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
    stubApiFetch({ tags: [] })
    vi.stubGlobal('Worker', class {
      addEventListener = vi.fn()
      postMessage = vi.fn()
    })

    const wrapper = mountSlot()
    await vi.runOnlyPendingTimersAsync()

    expect(wrapper.find('[data-control="select-menu"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Save tags')
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
    stubApiFetch({ tags: [] })
    vi.stubGlobal('Worker', class {
      addEventListener = vi.fn()
      postMessage = vi.fn()
    })

    const wrapper = mountSlot()

    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    expect(wrapper.text().match(/Suggested tags/g)).toHaveLength(1)
  })

  it('renders input tags for custom mode and writes typed custom tags to the agreement payload', async () => {
    stubApiFetch({ tags: [] })
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
    stubApiFetch({ tags: [] })
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
    stubApiFetch({ tags: [] })
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
    stubApiFetch({ tags: [] })
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

  it('loads Proponent tag choices from every eligible agency without choosing one', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const second = url.includes('agency%2F2')
      const agencyId = second ? 'agency/2' : 'agency/1'
      const key = second ? 'capacity-building' : 'infrastructure'
      const label = second ? 'Capacity building' : 'Infrastructure'
      return mockFetchResponse({
        tags: [],
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
    stubApiFetch({ tags: [] })
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
    stubApiFetch({ tags: [] })
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
    expect((globalThis as any).__gcsNarrativeTagsWorkerState.worker).toBeNull()
  })
})
