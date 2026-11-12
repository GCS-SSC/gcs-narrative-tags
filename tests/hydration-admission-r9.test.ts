// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import type { GcsAgreementDescriptionsExtensionContext, GcsExtensionJsonConfig, GcsProponentDescriptionsExtensionContext } from '@gcs-ssc/extensions'
import { installExtensionTestUiRuntime } from '@gcs-ssc/extensions/testing'
import ActualInputTags from '@nuxt/ui/runtime/components/InputTags.vue'
import { Kysely, sql } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import NarrativeTagsSlot from '../components/NarrativeTagsSlot.vue'
import { createNarrativeTagSourceProjection, normalizeNarrativeTagsConfig } from '../components/narrative-tags'
import type { NarrativeTagValue } from '../components/narrative-tags'
import plugin from '../server/nitro-plugin'

type FixtureDatabase = Record<string, Record<string, unknown>>
type Hook = Parameters<Parameters<typeof plugin>[0]['hooks']['hook']>[1]
const hooks = new Map<string, Hook>()
plugin({ hooks: { hook: (name, handler) => {
  hooks.set(name, handler)
} } })
const field = 'agreement.description'
const prior: NarrativeTagValue = { predefined: false, label: 'Previously saved' }
const added: NarrativeTagValue = { predefined: false, label: 'New choice' }
const config = { enabled: true, allowCustomTags: true }
const response = (tags: NarrativeTagValue[] = [prior]) => ({
  ok: true, status: 200,
  text: async () => JSON.stringify({ tags, textFieldTags: { [field]: tags } })
})
let db: Kysely<FixtureDatabase>
const wrappers: ReturnType<typeof mount>[] = []

/**
 * Mounts the Agreement host payload binding with the installed native control.
 * @param ownerId - Existing Agreement ID, or blank for create.
 * @returns The mounted editor and reactive host inputs.
 */
const openEditor = (ownerId: string | undefined = '44') => {
  const extensions = ref<Record<string, Record<string, unknown>>>({})
  const settings = ref<GcsExtensionJsonConfig>(config)
  const agreementId = ref(ownerId)
  const streamId = ref('31')
  /**
   * Renders the slot with reactive host form inputs.
   * @returns The slot node.
   */
  const renderSlot = () => h(NarrativeTagsSlot, {
    config: settings.value,
    context: {
      kind: 'agreement.descriptions', streamId: streamId.value, agreementId: agreementId.value,
      descriptions: { en: 'Current narrative', fr: '' }, extensions: extensions.value,
      /**
       * Copies the same namespaced payload submitted by the host profile form.
       * @param key - Extension namespace.
       * @param name - Payload field.
       * @param value - Replacement value.
       */
      setExtensionPayload: (key, name, value) => {
        extensions.value = { ...extensions.value, [key]: { ...extensions.value[key], [name]: value } }
      }
    } satisfies GcsAgreementDescriptionsExtensionContext
  })
  const Host = defineComponent({ setup: () => renderSlot })
  const wrapper = mount(Host, { attachTo: document.body })
  wrappers.push(wrapper)
  return { wrapper, extensions, settings, agreementId, streamId }
}

/**
 * Adds a chip using the installed InputTags keyboard behavior.
 * @param wrapper - Mounted editor.
 * @param label - Authored chip label.
 */
const enterTag = async (wrapper: ReturnType<typeof mount>, label = added.label) => {
  await wrapper.get('input').setValue(label)
  await wrapper.get('input').trigger('keydown', { key: 'Enter' })
  await flushPromises()
}

/**
 * Runs the real profile extension hook on the transaction used for Save.
 * @param extensions - Host form extension payload.
 */
const saveProfile = async (extensions: Record<string, Record<string, unknown>>) => {
  const hook = hooks.get('agreement:profile:updated')
  if (!hook) throw new Error('Missing profile hook')
  await db.transaction().execute(async trx => {
    await hook({ db: trx, event: { context: { $db: db } }, agreementId: '44', streamId: '31', rawBody: { extensions } })
  })
}

/**
 * Reads the persisted field map after the real hook commits.
 * @returns The stored Agreement field tags.
 */
const storedTags = async () => {
  const row = await db.selectFrom('extensions.kv_entry').select('value')
    .where('config_key', '=', 'text-field-tags').where('owner_id', '=', '44').executeTakeFirstOrThrow()
  return row.value
}

describe('tag replacement requires an accepted baseline through native InputTags and the real profile hook', () => {
  beforeAll(async () => {
    const pg = await KyselyPGlite.create('memory://')
    db = new Kysely<FixtureDatabase>({ dialect: pg.dialect })
    for (const ddl of [
      'CREATE SCHEMA extensions',
      'CREATE TABLE extensions.stream_configuration (extension_key text, stream_id text, enabled boolean, config jsonb, _deleted boolean DEFAULT false)',
      'CREATE TABLE extensions.kv_entry (id bigserial PRIMARY KEY, extension_key text, owner_type text, owner_id text, config_key text, value jsonb, _deleted boolean DEFAULT false)'
    ]) await sql.raw(ddl).execute(db)
    await sql`INSERT INTO extensions.stream_configuration VALUES ('gcs-narrative-tags', '31', true, ${JSON.stringify(config)}::jsonb, false)`.execute(db)
  }, 15000)

  beforeEach(async () => {
    await sql`DELETE FROM extensions.kv_entry`.execute(db)
    await sql`INSERT INTO extensions.kv_entry (extension_key, owner_type, owner_id, config_key, value)
      VALUES ('gcs-narrative-tags', 'fundingcaseagreement', '44', 'text-field-tags', ${JSON.stringify({ [field]: [prior] })}::jsonb)`.execute(db)
    vi.stubGlobal('Worker', class {
      /** Registers no worker events in this control and persistence fixture. */
      addEventListener() {}
      /** Skips model inference, which does not participate in native tag edits. */
      postMessage() {}
    })
    installExtensionTestUiRuntime().components.UInputTags = ActualInputTags
  })
  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount()
    vi.unstubAllGlobals()
  })
  afterAll(async () => {
    await db.destroy()
  })

  it('does not replace unknown persisted tags after failed first GET, native Enter and Save', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('Temporary GET outage')
    }))
    const editor = openEditor()
    await flushPromises()
    await enterTag(editor.wrapper)
    expect(editor.wrapper.text()).toContain(added.label)
    await saveProfile(editor.extensions.value)
    expect(await storedTags()).toEqual({ [field]: [prior] })
    expect(editor.extensions.value).toEqual({})
  })

  it('merges a native addition with the successful initial GET before profile Save', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response()))
    const editor = openEditor()
    await flushPromises()
    await enterTag(editor.wrapper)
    expect(editor.extensions.value['gcs-narrative-tags']?.agreementDescriptionTags).toEqual([prior, added])
    await saveProfile(editor.extensions.value)
    expect(await storedTags()).toEqual({ [field]: [prior, added] })
  })

  it('keeps local additions private until the edit-triggered retry accepts and merges the saved baseline', async () => {
    let completeRetry: ((value: ReturnType<typeof response>) => void) | undefined
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('First GET failed'))
      .mockImplementationOnce(() => new Promise(resolve => { completeRetry = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    const editor = openEditor()
    await flushPromises()
    await enterTag(editor.wrapper)
    await enterTag(editor.wrapper, 'Another local choice')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(editor.extensions.value).toEqual({})
    await saveProfile(editor.extensions.value)
    expect(await storedTags()).toEqual({ [field]: [prior] })
    completeRetry?.(response())
    await flushPromises()
    expect(editor.extensions.value['gcs-narrative-tags']?.agreementDescriptionTags).toEqual([
      prior, added, { predefined: false, label: 'Another local choice' }
    ])
    await saveProfile(editor.extensions.value)
    expect(await storedTags()).toEqual({ [field]: [prior, added, { predefined: false, label: 'Another local choice' }] })
  })

  it('retains the accepted same-owner baseline when a configuration refresh fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response()).mockRejectedValueOnce(new Error('Refresh failed')))
    const editor = openEditor()
    await flushPromises()
    editor.settings.value = { ...config, tags: [{ key: 'new-key', label: { en: 'New key', fr: 'Nouvelle clé' } }] }
    await flushPromises()
    expect(editor.wrapper.text()).toContain(prior.label)
    await enterTag(editor.wrapper)
    await saveProfile(editor.extensions.value)
    expect(await storedTags()).toEqual({ [field]: [prior, added] })
  })

  it('publishes an edit made during a failed refresh from the already accepted baseline', async () => {
    let failRefresh: ((reason: Error) => void) | undefined
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response())
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { failRefresh = reject })))
    const editor = openEditor()
    await flushPromises()
    editor.settings.value = { ...config, tags: [{ key: 'new-key', label: { en: 'New key', fr: 'Nouvelle clé' } }] }
    await flushPromises()
    await enterTag(editor.wrapper)
    failRefresh?.(new Error('Refresh failed'))
    await flushPromises()
    await saveProfile(editor.extensions.value)
    expect(await storedTags()).toEqual({ [field]: [prior, added] })
  })

  it('rejects an old retry settlement after owner replacement and keeps the new local draft private', async () => {
    let completeOldRetry: ((value: ReturnType<typeof response>) => void) | undefined
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('First GET failed'))
      .mockImplementationOnce(() => new Promise(resolve => { completeOldRetry = resolve }))
      .mockRejectedValue(new Error('Replacement GET failed')))
    const editor = openEditor()
    await flushPromises()
    await enterTag(editor.wrapper)
    editor.agreementId.value = '55'
    editor.extensions.value = {}
    await flushPromises()
    await enterTag(editor.wrapper, 'Replacement local choice')
    completeOldRetry?.(response())
    await flushPromises()
    expect(editor.wrapper.text()).not.toContain(prior.label)
    expect(editor.wrapper.text()).not.toContain(added.label)
    expect(editor.wrapper.text()).toContain('Replacement local choice')
    expect(editor.extensions.value).toEqual({})
  })

  it('continues publishing explicit unsaved Agreement choices without a GET', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const editor = openEditor('')
    await flushPromises()
    await enterTag(editor.wrapper)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(editor.extensions.value['gcs-narrative-tags']?.agreementDescriptionTags).toEqual([added])
  })

  it('does not reuse an accepted baseline after switching to an unread owner', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response()).mockRejectedValue(new Error('New owner GET failed')))
    const editor = openEditor()
    await flushPromises()
    editor.agreementId.value = '55'
    editor.extensions.value = {}
    await flushPromises()
    await enterTag(editor.wrapper)
    expect(editor.wrapper.text()).not.toContain(prior.label)
    expect(editor.extensions.value).toEqual({})
  })

  it('does not treat an existing owner with missing read scope as an explicit create', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response()))
    const editor = openEditor()
    await flushPromises()
    editor.streamId.value = ''
    editor.extensions.value = {}
    await flushPromises()
    await enterTag(editor.wrapper)
    expect(editor.extensions.value).toEqual({})
  })

  it('retains the accepted Proponent membership and source-qualified labels after refresh failure', async () => {
    const source = { agencyId: '1', streamId: '11', streamName: { en: 'Stream One', fr: 'Volet Un' } }
    const sourcedPrior: NarrativeTagValue = { ...prior, source }
    const sources = [{ source, config: normalizeNarrativeTagsConfig(config) }]
    const projection = createNarrativeTagSourceProjection(sources)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true, status: 200,
      text: async () => JSON.stringify({ tags: [sourcedPrior], sources, sourceProjection: projection })
    }).mockRejectedValue(new Error('Refresh failed')))
    const settings = ref<GcsExtensionJsonConfig>(config)
    const extensions = ref<Record<string, Record<string, unknown>>>({})
    /**
     * Renders the app-wide Proponent slot with its accepted agency context.
     * @returns The slot node.
     */
    const renderSlot = () => h(NarrativeTagsSlot, {
      config: settings.value,
      context: {
        kind: 'proponent.descriptions', applicantRecipientId: '99',
        agencies: [{ agencyId: '1', nameEn: 'Agency One', nameFr: 'Agence Un', config: {} }],
        descriptions: { en: 'Current narrative', fr: '' }, extensions: extensions.value,
        /**
         * Mirrors the Proponent host form payload binding.
         * @param key - Extension namespace.
         * @param name - Payload field.
         * @param value - Replacement value.
         */
        setExtensionPayload: (key, name, value) => {
          extensions.value = { ...extensions.value, [key]: { ...extensions.value[key], [name]: value } }
        }
      } satisfies GcsProponentDescriptionsExtensionContext
    })
    const Host = defineComponent({ setup: () => renderSlot })
    const wrapper = mount(Host, { attachTo: document.body })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).toContain('Previously saved - 1 / Stream One')
    settings.value = { ...config, tags: [{ key: 'new-key', label: { en: 'New key', fr: 'Nouvelle clé' } }] }
    await flushPromises()
    await enterTag(wrapper)
    expect(extensions.value['gcs-narrative-tags']).toEqual({
      proponentSourceProjection: projection,
      textFieldTags: { 'proponent.description': [sourcedPrior, { ...added, source }] }
    })
  })
})
