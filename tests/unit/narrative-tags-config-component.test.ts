// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { JsonValue } from '@gcs-ssc/extensions'
import NarrativeTagsConfig from '../../components/NarrativeTagsConfig.vue'

const mountControlledEditor = () => {
    vi.stubGlobal('useI18n', () => ({ locale: { value: 'en' } }))
    const parentModel = ref<Record<string, JsonValue>>({})
    const Host = defineComponent({
      setup: () => () => h(NarrativeTagsConfig, {
        modelValue: parentModel.value,
        'onUpdate:modelValue': (value: Record<string, JsonValue>) => { parentModel.value = value }
      })
    })
    const wrapper = mount(Host, {
      attachTo: document.body,
      global: {
        stubs: {
          CommonSection: defineComponent({ setup: (_, { slots }) => () => h('section', slots.default?.()) }),
          UFormField: defineComponent({ setup: (_, { slots }) => () => h('label', slots.default?.()) }),
          UInput: defineComponent({
            props: ['modelValue'],
            emits: ['update:modelValue'],
            setup: (props, { emit, attrs }) => () => h('input', {
              ...attrs,
              value: props.modelValue,
              onInput: (event: Event) => {
                if (event.target instanceof HTMLInputElement) emit('update:modelValue', event.target.value)
              }
            })
          }),
          UButton: defineComponent({
            emits: ['click'],
            setup: (_, { emit, attrs }) => () => h('button', { ...attrs, onClick: () => emit('click') })
          }),
          CommonTextarea: true,
          USwitch: true,
          USelect: true,
          UTooltip: true,
          UInputTags: true
        }
      }
    })
    return { wrapper, parentModel }
}

describe('NarrativeTagsConfig', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retains tag row inputs and keyboard focus across key edits, controlled echoes, and earlier removal', async () => {
    const { wrapper, parentModel } = mountControlledEditor()
    try {
      const input = wrapper.findAll<HTMLInputElement>('.border-default input')[3]!
      const element = input.element
      element.focus()
      await input.setValue('changed-key')
      await flushPromises()
      expect(element.isConnected).toBe(true)
      expect(document.activeElement).toBe(element)
      expect(element.value).toBe('changed-key')
      expect(JSON.stringify(parentModel.value)).not.toContain('renderKey')

      await wrapper.findAll('.border-default button')[0]!.trigger('click')
      await flushPromises()
      expect(wrapper.findAll<HTMLInputElement>('.border-default input')[0]!.element).toBe(element)
      expect(document.activeElement).toBe(element)
    } finally {
      wrapper.unmount()
    }
  })

  it.each([
    ['key', 0, 'replacement-key'],
    ['English label', 1, 'Replacement label'],
    ['French label', 2, 'Libellé de remplacement']
  ] as const)('preserves a temporarily cleared %s through its controlled echo and replacement', async (_field, offset, replacement) => {
    const { wrapper, parentModel } = mountControlledEditor()
    try {
      const inputs = wrapper.findAll<HTMLInputElement>('.border-default input')
      const input = inputs[3 + offset]!
      const element = input.element
      element.focus()
      await input.setValue('')
      await flushPromises()
      expect(wrapper.findAll('.border-default input')).toHaveLength(inputs.length)
      expect(element.isConnected).toBe(true)
      expect(document.activeElement).toBe(element)
      expect(element.value).toBe('')
      expect(JSON.stringify(parentModel.value)).toContain('""')
      expect(JSON.stringify(parentModel.value)).not.toContain('renderKey')

      await input.setValue(replacement)
      await flushPromises()
      expect(element.value).toBe(replacement)
      expect(element.isConnected).toBe(true)
      expect(document.activeElement).toBe(element)
      expect(JSON.stringify(parentModel.value)).toContain(replacement)
    } finally {
      wrapper.unmount()
    }
  })

  it('retains temporary duplicate keys as local drafts and rehydrates a genuine external replacement', async () => {
    const { wrapper, parentModel } = mountControlledEditor()
    try {
      const inputs = wrapper.findAll<HTMLInputElement>('.border-default input')
      const firstKey = inputs[0]!.element.value
      const input = inputs[3]!
      const element = input.element
      element.focus()
      await input.setValue(firstKey)
      await flushPromises()
      expect(wrapper.findAll('.border-default input')).toHaveLength(inputs.length)
      expect(element.isConnected).toBe(true)
      expect(document.activeElement).toBe(element)
      expect(element.value).toBe(firstKey)
      expect(JSON.stringify(parentModel.value)).not.toContain('renderKey')

      await input.setValue('unique-replacement')
      await flushPromises()
      expect(element.value).toBe('unique-replacement')
      parentModel.value = {
        tags: [{
          key: 'external-tag',
          label: { en: 'External replacement', fr: 'Remplacement externe' },
          description: { en: '', fr: '' },
          aliases: [],
          color: 'neutral'
        }]
      }
      await flushPromises()
      expect(element.isConnected).toBe(false)
      const replacementInputs = wrapper.findAll<HTMLInputElement>('.border-default input')
      expect(replacementInputs).toHaveLength(3)
      expect(replacementInputs.map(field => field.element.value)).toEqual([
        'external-tag', 'External replacement', 'Remplacement externe'
      ])
      expect(JSON.stringify(parentModel.value)).not.toContain('renderKey')
    } finally {
      wrapper.unmount()
    }
  })

  it.each(['en', 'fr'])('renders %s configuration labels and preserves semantic color values', locale => {
    vi.stubGlobal('useI18n', () => ({ locale: { value: locale } }))

    const wrapper = mount(NarrativeTagsConfig, {
      props: {
        modelValue: {}
      },
      global: {
        stubs: {
          CommonSection: defineComponent({
            setup: (_, { slots }) => () => h('section', slots.default?.())
          }),
          UFormField: defineComponent({
            setup: (_, { slots }) => () => h('label', slots.default?.())
          }),
          UInput: true,
          CommonTextarea: true,
          USwitch: true,
          USelect: defineComponent({
            props: ['items'],
            setup: props => () => h('div', { 'data-options': JSON.stringify(props.items) })
          }),
          UTooltip: true,
          UButton: true,
          UInputTags: defineComponent({
            props: ['modelValue'],
            setup: props => () => h('div', {
              'data-input-tags': JSON.stringify(props.modelValue ?? [])
            })
          })
        }
      }
    })

    expect(wrapper.find('[data-input-tags]').exists()).toBe(true)
    expect(wrapper.findAll('u-input-stub[lang]').map(input => input.attributes('lang'))).toEqual(['en', 'fr', 'en', 'fr', 'en', 'fr'])
    expect(wrapper.findAllComponents({ name: 'UTextarea' }).map(input => input.vm.$attrs.lang)).toEqual(['en', 'fr', 'en', 'fr', 'en', 'fr'])
    const colorOptions = wrapper.findAll('[data-options]').map(control => control.attributes('data-options')).find(options => options?.includes('"value":"primary"'))
    expect(colorOptions).toContain(`"label":"${locale === 'fr' ? 'Principale' : 'Primary'}","value":"primary"`)
    expect(colorOptions).toContain(`"label":"${locale === 'fr' ? 'Neutre' : 'Neutral'}","value":"neutral"`)
  })

  it('updates tag suggestion, custom tag, and cache switches through model events', async () => {
    vi.stubGlobal('useI18n', () => ({ locale: { value: 'en' } }))

    const switchStub = defineComponent({
      props: ['modelValue'],
      emits: ['update:modelValue'],
      setup: (props, { emit }) => () => h('button', {
        'data-control': 'switch',
        'data-checked': String(props.modelValue),
        onClick: () => emit('update:modelValue', props.modelValue !== true)
      })
    })

    const wrapper = mount(NarrativeTagsConfig, {
      props: {
        modelValue: {
          targets: {
            'agreement.description': {
              enabled: false,
              allowCustomTags: false
            },
            'proponent.description': {
              enabled: true,
              allowCustomTags: false
            }
          }
        }
      },
      global: {
        stubs: {
          CommonSection: defineComponent({
            setup: (_, { slots }) => () => h('section', slots.default?.())
          }),
          UFormField: defineComponent({
            setup: (_, { slots }) => () => h('label', slots.default?.())
          }),
          UInput: true,
          CommonTextarea: true,
          USwitch: switchStub,
          USelect: true,
          UTooltip: true,
          UButton: true,
          UInputTags: true
        }
      }
    })

    const switches = wrapper.findAll('[data-control="switch"]')
    expect(switches).toHaveLength(5)
    await switches[0].trigger('click')
    await switches[1].trigger('click')
    await switches[2].trigger('click')

    const updates = wrapper.emitted('update:modelValue') ?? []
    expect(JSON.stringify(updates.at(-1)?.[0])).toContain('"agreement.description":{"enabled":true')
    expect(JSON.stringify(updates.at(-1)?.[0])).toContain('"allowCustomTags":true')
    expect(JSON.stringify(updates.at(-1)?.[0])).toContain('"allowDynamicTagSuggestions":true')
  })
})
