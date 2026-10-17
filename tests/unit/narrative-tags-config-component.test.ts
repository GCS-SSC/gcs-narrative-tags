// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import NarrativeTagsConfig from '../../components/NarrativeTagsConfig.vue'

describe('NarrativeTagsConfig', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
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
