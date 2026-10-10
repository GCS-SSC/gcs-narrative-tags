// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import NarrativeTagsConfig from '../../components/NarrativeTagsConfig.vue'

describe('NarrativeTagsConfig', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses InputTags for predefined tag aliases', () => {
    vi.stubGlobal('useI18n', () => ({ locale: { value: 'en' } }))

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
          USelect: true,
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
