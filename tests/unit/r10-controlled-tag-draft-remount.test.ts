// @vitest-environment jsdom
/* eslint-disable jsdoc/require-jsdoc -- local fixture helpers expose the controlled payload protocol. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import type { GcsProponentDescriptionsExtensionContext } from '@gcs-ssc/extensions'
import { installExtensionTestUiRuntime } from '@gcs-ssc/extensions/testing'
import NarrativeTagsSlot from '../../components/NarrativeTagsSlot.vue'
import { createNarrativeTagSourceProjection, normalizeNarrativeTagsConfig } from '../../components/narrative-tags'
import type { NarrativeTagValue } from '../../components/narrative-tags'

const source = { agencyId: '11', agencyName: { en: 'Agency', fr: 'Agence' } }
const config = { enabled: true, allowCustomTags: true }
const sources = [{ source, config: normalizeNarrativeTagsConfig(config) }]
const prior: NarrativeTagValue = { predefined: false, label: 'Previously saved', source }
const projection = createNarrativeTagSourceProjection(sources)
const wrappers: ReturnType<typeof mount>[] = []
const InputTags = defineComponent({
  props: { modelValue: { type: Array, default: () => [] } },
  emits: ['update:modelValue'],
  setup: (props, { emit }) => () => h('input', {
    value: props.modelValue.join(','),
    onInput: (event: Event) => {
      if (event.target instanceof HTMLInputElement) {
        emit('update:modelValue', event.target.value ? event.target.value.split(',') : [])
      }
    }
  })
})

const openEditor = (extensions = ref<Record<string, Record<string, unknown>>>({})) => {
  const visible = ref(true)
  const ownerId = ref('51')
  const Host = defineComponent({
    setup: () => () => visible.value
      ? h(NarrativeTagsSlot, {
          config,
          context: {
            kind: 'proponent.descriptions', applicantRecipientId: ownerId.value,
            agencies: [{ agencyId: '11', nameEn: 'Agency', nameFr: 'Agence', config: {} }],
            descriptions: { en: 'Current narrative', fr: '' }, extensions: extensions.value,
            setExtensionPayload: (key, name, value) => {
              extensions.value = { ...extensions.value, [key]: { ...extensions.value[key], [name]: value } }
            }
          } satisfies GcsProponentDescriptionsExtensionContext
        })
      : null
  })
  const wrapper = mount(Host)
  wrappers.push(wrapper)
  return { wrapper, visible, ownerId, extensions }
}
const tagsInPayload = (extensions: Record<string, Record<string, unknown>>) => {
  const payload = extensions['gcs-narrative-tags']?.textFieldTags
  return payload && typeof payload === 'object' && 'proponent.description' in payload
    ? payload['proponent.description']
    : undefined
}
const remount = async (editor: ReturnType<typeof openEditor>) => {
  editor.visible.value = false
  await flushPromises()
  editor.visible.value = true
  await flushPromises()
}

beforeEach(() => {
  installExtensionTestUiRuntime().components.UInputTags = InputTags
  vi.stubGlobal('Worker', class { addEventListener() {} postMessage() {} })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ tags: [prior], sources, sourceProjection: projection }))))
})
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.unstubAllGlobals()
})

describe('accepted Proponent tag draft belongs to the controlled editor payload', () => {
  it.each([{ labels: ['New choice'] }, { labels: [] }])('retains the intentional replacement $labels through slot disposal and remount', async ({ labels }) => {
    const editor = openEditor()
    await flushPromises()
    await editor.wrapper.get('input').setValue(labels.join(','))
    await remount(editor)
    expect(tagsInPayload(editor.extensions.value)).toEqual(labels.map(label => ({ predefined: false, label, source })))
    expect(JSON.stringify(editor.extensions.value)).not.toContain('accepted-narrative-tag-draft')
    expect(Object.getOwnPropertySymbols(editor.extensions.value['gcs-narrative-tags']?.textFieldTags ?? {})).toHaveLength(1)
  })

  it('does not promote embedded persisted JSON or an empty array after an unknown first read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('Unknown baseline')
    }))
    const extensions = ref<Record<string, Record<string, unknown>>>({ 'gcs-narrative-tags': {
      textFieldTags: { 'proponent.description': [] }, proponentSourceProjection: projection
    } })
    const editor = openEditor(extensions)
    await flushPromises()
    await editor.wrapper.get('input').setValue('Unaccepted local choice')
    await remount(editor)
    expect(tagsInPayload(extensions.value)).toEqual([])
    expect(extensions.value['gcs-narrative-tags']?.proponentSourceProjection).toBeNull()
    expect(Object.getOwnPropertySymbols(extensions.value['gcs-narrative-tags']?.textFieldTags ?? {})).toHaveLength(0)
  })

  it('retires accepted evidence when authoritative hydration replaces the controlled payload', async () => {
    const editor = openEditor()
    await flushPromises()
    await editor.wrapper.get('input').setValue('New choice')
    editor.visible.value = false
    await flushPromises()
    editor.extensions.value = {}
    await remount(editor)
    expect(tagsInPayload(editor.extensions.value)).toEqual([prior])
  })

  it('does not reuse another resource accepted marker', async () => {
    const editor = openEditor()
    await flushPromises()
    await editor.wrapper.get('input').setValue('Old draft')
    editor.visible.value = false
    await flushPromises()
    editor.ownerId.value = '52'
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('Unread replacement')
    }))
    await remount(editor)
    expect(editor.wrapper.get<HTMLInputElement>('input').element.value).toBe('')
    expect(editor.extensions.value['gcs-narrative-tags']?.proponentSourceProjection).toBeNull()
  })
})
