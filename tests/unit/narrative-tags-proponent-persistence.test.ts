// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { TagsInputRoot, TagsInputItem, TagsInputItemText, TagsInputItemDelete, TagsInputInput } from 'reka-ui'
import type { GcsProponentDescriptionsExtensionContext } from '@gcs-ssc/extensions'
import type { GcsExtensionAgreementAccess } from '@gcs-ssc/extensions/server'
import { Kysely, sql } from 'kysely'
import type { DatabaseConnection, Dialect, Transaction } from 'kysely'
import { KyselyPGlite } from 'kysely-pglite'
import NarrativeTagsSlot from '../../components/NarrativeTagsSlot.vue'
import type { NarrativeTagValue } from '../../components/narrative-tags'
import getTags from '../../server/api/extensions/gcs-narrative-tags/agencies/[agencyId]/applicant-recipients/[applicantRecipientId]/tags.get'
import plugin from '../../server/nitro-plugin'
import {
  getPersistedTextFieldTags,
  mergePersistedProponentTextFieldTags,
  NARRATIVE_TAGS_EXTENSION_KEY as extensionKey,
  requireNarrativeTagsRouteDatabase
} from '../../server/narrative-tags-route'

const actualTagsControl = defineComponent({
  props: ['modelValue'], emits: ['update:modelValue'],
  setup: (props, { emit }) => () => h(TagsInputRoot, {
    modelValue: props.modelValue, 'onUpdate:modelValue': value => emit('update:modelValue', value)
  }, () => [
    ...(props.modelValue ?? []).map((item: string, index: number) => h(TagsInputItem, { value: item }, () => [
      h(TagsInputItemText), h(TagsInputItemDelete, { 'data-delete-index': index }, () => 'Remove')
    ])), h(TagsInputInput)
  ])
})

type FixtureDatabase = Record<string, Record<string, unknown>>
type Hook = Parameters<Parameters<typeof plugin>[0]['hooks']['hook']>[1]
const field = 'proponent.description'
const sourceA = { agencyId: '1', streamId: '11' }
const sourceB = { agencyId: '2', streamId: '21' }
const tagA: NarrativeTagValue = { predefined: false, label: 'A retained custom tag', source: sourceA }
const tagB: NarrativeTagValue = { predefined: false, label: 'B retained custom tag', source: sourceB }
const config = {
  allowCustomTags: true,
  tags: [{ key: 'priority', label: { en: 'Priority', fr: 'Priorité' } }]
}
let db: Kysely<FixtureDatabase>
const queries: string[] = []
const hooks = new Map<string, Hook>()
plugin({ hooks: { hook: (name, handler) => { hooks.set(name, handler) } } })

// Like the host's PGlite owner, hold its single connection for the whole Kysely lease/transaction.
const serializePGliteConnection = (dialect: Dialect): Dialect => ({
  ...dialect,
  createDriver: () => {
    const driver = dialect.createDriver()
    let tail = Promise.resolve()
    const releases = new WeakMap<DatabaseConnection, () => void>()
    return {
      init: async () => await driver.init(),
      acquireConnection: async () => {
        const previous = tail
        let release = () => {}
        tail = new Promise<void>(resolve => { release = resolve })
        await previous
        try {
          const connection = await driver.acquireConnection()
          releases.set(connection, release)
          return connection
        } catch (error) { release(); throw error }
      },
      releaseConnection: async connection => {
        try { await driver.releaseConnection(connection) } finally { releases.get(connection)?.() }
      },
      beginTransaction: async (connection, settings) => await driver.beginTransaction(connection, settings),
      commitTransaction: async connection => await driver.commitTransaction(connection),
      rollbackTransaction: async connection => await driver.rollbackTransaction(connection),
      destroy: async () => await driver.destroy()
    }
  }
})

const agreementAccess = (visibleAgreementIds: string[]): GcsExtensionAgreementAccess => ({
  listVisibleOptions: async () => visibleAgreementIds.map(id => ({ id, label: id, agreementNumber: id }))
})

const seedTags = async (value: unknown) => {
  await sql`INSERT INTO extensions.kv_entry
    (extension_key, owner_type, owner_id, config_key, value)
    VALUES (${extensionKey}, 'applicantrecipient', '99', 'text-field-tags', ${JSON.stringify(value)}::jsonb)`
    .execute(db)
}

const storedTags = async () => {
  const row = await db.selectFrom('extensions.kv_entry').select('value').executeTakeFirst()
  return row?.value
}

const readTags = async (agencyId: string, visibleAgreementIds: string[]) => await getTags({
  context: {
    $db: db,
    params: { extensionKey, agencyId, applicantRecipientId: '99' },
    $authContext: { userId: '7', userAbilities: { authorize: () => true } },
    gcsExtension: { config: {}, agencyConfig: {}, agreementAccess: agreementAccess(visibleAgreementIds) }
  }
})

const saveProfile = async (
  rawBody: Record<string, unknown>,
  agencyIds = ['1'],
  visibleAgreementIds = ['111'],
  afterHook?: (trx: Transaction<FixtureDatabase>) => Promise<void>
) => await db.transaction().execute(async trx => {
  // The real host acquires this aggregate lock after fresh auth/config scope locks, before the hook.
  await trx.selectFrom('Applicant_Recipient_Profile').select('id').where('id', '=', '99').forUpdate().executeTakeFirstOrThrow()
  await trx.updateTable('Applicant_Recipient_Profile').set({ egcs_ar_description_en: 'Saved description' }).where('id', '=', '99').execute()
  await hooks.get('applicantrecipient:profile:updated')?.({
    db: trx, applicantRecipientId: '99', agencyIds,
    agreementAccess: agreementAccess(visibleAgreementIds), rawBody
  })
  await afterHook?.(trx)
})

const payload = (textFieldTags: Record<string, unknown>, sourceKeys = ['1:11', '1:agency']) => ({
  extensions: { [extensionKey]: { textFieldTags, proponentSourceProjection: { version: 1, sourceKeys } } }
})

const openSlot = async (agencyIds = ['1'], visibleAgreementIds = ['111'], actualControl = false) => {
  const responses = await Promise.all(agencyIds.map(agencyId => readTags(agencyId, visibleAgreementIds)))
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const index = agencyIds.findIndex(agencyId => url.includes(`/agencies/${agencyId}/`))
    if (index < 0) throw new Error(`Unexpected tag request: ${url}`)
    return { ok: true, status: 200, text: async () => JSON.stringify(responses[index]) }
  }))
  const extensionPayload: Record<string, unknown> = {}
  const context: GcsProponentDescriptionsExtensionContext = {
    kind: 'proponent.descriptions', applicantRecipientId: '99',
    agencies: agencyIds.map(agencyId => ({ agencyId, nameEn: agencyId, nameFr: agencyId, config: {} })),
    descriptions: { en: 'An unrelated description correction.', fr: '' }, extensions: {},
    setExtensionPayload: (_key, name, value) => { extensionPayload[name] = value }
  }
  const wrapper = mount(NarrativeTagsSlot, {
    props: { config: {}, context },
    global: { stubs: actualControl ? { UInputTags: actualTagsControl } : {} }
  })
  await flushPromises()
  return { wrapper, responses, rawBody: { extensions: { [extensionKey]: extensionPayload } } }
}

describe('Proponent visible-source persistence through the real GET, slot, hook and KV', () => {
  beforeAll(async () => {
    const dialect = await KyselyPGlite.create('memory://')
    db = new Kysely<FixtureDatabase>({
      dialect: serializePGliteConnection(dialect.dialect),
      log: event => { if (event.level === 'query') queries.push(event.query.sql) }
    })
    // Reduced structural fixture; authorization admission is supplied, not simulated by these tables.
    const ddl = `
      CREATE SCHEMA extensions;
      CREATE TABLE "Applicant_Recipient_Profile" (id text PRIMARY KEY, egcs_ar_description_en text, _deleted boolean DEFAULT false);
      CREATE TABLE "Agency_Profile" (id text PRIMARY KEY, egcs_ay_name_en text, egcs_ay_name_fr text, egcs_ay_abbreviation_en text, egcs_ay_abbreviation_fr text, _deleted boolean DEFAULT false);
      CREATE TABLE "Transfer_Payment_Profile" (id text PRIMARY KEY, egcs_tp_agency text, _deleted boolean DEFAULT false);
      CREATE TABLE "Transfer_Payment_Stream" (id text PRIMARY KEY, egcs_tp_transferpaymentprofile text, egcs_tp_name_en text, egcs_tp_name_fr text, _deleted boolean DEFAULT false);
      CREATE TABLE "Funding_Case_Agreement_Profile" (id text PRIMARY KEY, egcs_fc_transferpaymentstream text, _deleted boolean DEFAULT false);
      CREATE TABLE "Funding_Case_Agreement_Applicant_Recipient" (egcs_fc_fundingagreement text, egcs_fc_applicantrecipient text, _deleted boolean DEFAULT false);
      CREATE TABLE extensions.agency_enablement (extension_key text, agency_id text, enabled boolean, _deleted boolean DEFAULT false);
      CREATE TABLE extensions.stream_configuration (extension_key text, stream_id text, enabled boolean, config jsonb, _deleted boolean DEFAULT false);
      CREATE TABLE extensions.kv_entry (id bigserial PRIMARY KEY, extension_key text, owner_type text, owner_id text, config_key text, value jsonb, _deleted boolean DEFAULT false);
      CREATE UNIQUE INDEX kv_active ON extensions.kv_entry(extension_key, owner_type, owner_id, config_key) WHERE NOT _deleted;
      INSERT INTO "Applicant_Recipient_Profile" VALUES ('99', 'Original description');
      INSERT INTO "Agency_Profile" (id, egcs_ay_name_en, egcs_ay_name_fr) VALUES ('1', 'Agency One', 'Agence Un'), ('2', 'Agency Two', 'Agence Deux');
      INSERT INTO "Transfer_Payment_Profile" (id, egcs_tp_agency) VALUES ('10', '1'), ('20', '2');
      INSERT INTO "Transfer_Payment_Stream" (id, egcs_tp_transferpaymentprofile, egcs_tp_name_en, egcs_tp_name_fr) VALUES ('11', '10', 'Stream One', 'Volet Un'), ('12', '10', 'Hidden Stream', 'Volet caché'), ('21', '20', 'Stream Two', 'Volet Deux');
      INSERT INTO "Funding_Case_Agreement_Profile" (id, egcs_fc_transferpaymentstream) VALUES ('111', '11'), ('121', '12'), ('211', '21');
      INSERT INTO "Funding_Case_Agreement_Applicant_Recipient" (egcs_fc_fundingagreement, egcs_fc_applicantrecipient) VALUES ('111', '99'), ('121', '99'), ('211', '99');
    `
    for (const statement of ddl.split(';').filter(value => value.trim())) await sql.raw(statement).execute(db)
    for (const agencyId of ['1', '2']) {
      await sql`INSERT INTO extensions.agency_enablement VALUES (${extensionKey}, ${agencyId}, true, false)`.execute(db)
    }
    for (const streamId of ['11', '12', '21']) {
      await sql`INSERT INTO extensions.stream_configuration VALUES (${extensionKey}, ${streamId}, true, ${JSON.stringify(config)}::jsonb, false)`.execute(db)
    }
  }, 15000)

  beforeEach(async () => {
    await sql`DELETE FROM extensions.kv_entry`.execute(db)
    await db.updateTable('Applicant_Recipient_Profile').set({ egcs_ar_description_en: 'Original description' }).execute()
    await db.updateTable('extensions.stream_configuration').set({ enabled: true }).execute()
    queries.length = 0
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
  afterAll(async () => { await db.destroy() })

  it.each([
    { agencyIds: ['1'], agreements: ['111'], visible: tagA, hidden: tagB },
    { agencyIds: ['2'], agreements: ['211'], visible: tagB, hidden: tagA }
  ])('retains hidden Agency tags on an ordinary profile Save by $agencyIds', async ({ agencyIds, agreements, visible, hidden }) => {
    await seedTags({ [field]: [tagA, tagB] })
    const opened = await openSlot(agencyIds, agreements)
    try {
      expect(opened.responses[0]?.tags).toEqual([visible])
      expect(opened.wrapper.text()).not.toContain(hidden.label)
      expect(opened.rawBody).toEqual(payload({ [field]: [visible] }, opened.responses.flatMap(response => response.sourceProjection.sourceKeys).sort()))
      await saveProfile(opened.rawBody, agencyIds, agreements)
      expect(await storedTags()).toMatchObject({ [field]: [hidden, visible] })
      expect((await readTags(agencyIds[0]!, agreements)).tags).toMatchObject([visible])
    } finally { opened.wrapper.unmount() }
  })

  it('rejects a source enabled after the real GET without erasing its unseen saved tag', async () => {
    const hidden: NarrativeTagValue = { predefined: false, label: 'Not read by this editor', source: { agencyId: '1', streamId: '12' } }
    await seedTags({ [field]: [tagA, hidden] })
    await db.updateTable('extensions.stream_configuration').set({ enabled: false }).where('stream_id', '=', '12').execute()
    const opened = await openSlot(['1'], ['111', '121'])
    try {
      expect(opened.responses[0]?.tags).toEqual([tagA])
      expect(opened.responses[0]?.sourceProjection).toEqual({ version: 1, sourceKeys: ['1:11', '1:agency'] })
      await db.updateTable('extensions.stream_configuration').set({ enabled: true }).where('stream_id', '=', '12').execute()
      await expect(saveProfile(opened.rawBody, ['1'], ['111', '121']))
        .rejects.toMatchObject({ code: 'GCS_NARRATIVE_TAGS_SOURCE_PROJECTION_CHANGED', statusCode: 409 })
      expect(await storedTags()).toEqual({ [field]: [tagA, hidden] })
      expect(await db.selectFrom('Applicant_Recipient_Profile').select('egcs_ar_description_en').executeTakeFirst())
        .toEqual({ egcs_ar_description_en: 'Original description' })
      const reloaded = await openSlot(['1'], ['111', '121'])
      try {
        expect(reloaded.responses[0]?.tags).toEqual([tagA, hidden])
        await saveProfile(reloaded.rawBody, ['1'], ['111', '121'])
        expect(await storedTags()).toMatchObject({ [field]: [tagA, hidden] })
      } finally { reloaded.wrapper.unmount() }
    } finally { opened.wrapper.unmount() }
  })

  it('preserves an unseen source while it remains disabled after the real GET', async () => {
    const hidden: NarrativeTagValue = { predefined: false, label: 'Still disabled', source: { agencyId: '1', streamId: '12' } }
    await seedTags({ [field]: [tagA, hidden] })
    await db.updateTable('extensions.stream_configuration').set({ enabled: false }).where('stream_id', '=', '12').execute()
    const opened = await openSlot(['1'], ['111', '121'])
    try {
      await saveProfile(opened.rawBody, ['1'], ['111', '121'])
      expect(await storedTags()).toMatchObject({ [field]: [hidden, tagA] })
    } finally { opened.wrapper.unmount() }
  })

  it.each([undefined, null, { version: 2, sourceKeys: ['1:11', '1:agency'] }, { version: 1, sourceKeys: ['1:11'] }, { version: 1, sourceKeys: ['1:11', '1:agency', '1:agency'] }])(
    'rejects missing, malformed or mismatched projection without changing profile or KV: %j', async projection => {
      await seedTags({ [field]: [tagA, tagB] })
      await expect(saveProfile({ extensions: { [extensionKey]: { textFieldTags: { [field]: [tagA] }, proponentSourceProjection: projection } } }))
        .rejects.toMatchObject({ code: 'GCS_NARRATIVE_TAGS_SOURCE_PROJECTION_CHANGED', statusCode: 409 })
      expect(await storedTags()).toEqual({ [field]: [tagA, tagB] })
      expect(await db.selectFrom('Applicant_Recipient_Profile').select('egcs_ar_description_en').executeTakeFirst())
        .toEqual({ egcs_ar_description_en: 'Original description' })
    }
  )

  it('retains tags from an unreadable linked Agreement in the same authorized Agency', async () => {
    const hidden: NarrativeTagValue = { predefined: false, label: 'Hidden Agreement tag', source: { agencyId: '1', streamId: '12' } }
    await seedTags({ [field]: [tagA, hidden] })
    const opened = await openSlot()
    try {
      expect(opened.responses[0]?.tags).toEqual([tagA])
      await saveProfile(opened.rawBody)
      expect(await storedTags()).toMatchObject({ [field]: [hidden, tagA] })
    } finally { opened.wrapper.unmount() }
  })

  it('persists explicit visible deletion from the mounted control without deleting hidden tags', async () => {
    await seedTags({ [field]: [tagA, tagB] })
    const opened = await openSlot()
    try {
      await opened.wrapper.find('input').setValue('')
      await flushPromises()
      expect(opened.rawBody).toEqual(payload({ [field]: [] }))
      await saveProfile(opened.rawBody)
      expect(await storedTags()).toEqual({ [field]: [tagB] })
    } finally { opened.wrapper.unmount() }
  })

  it('keeps source-qualified identities when two visible Streams use the same predefined key', async () => {
    const first: NarrativeTagValue = { predefined: true, key: 'priority', label: 'Priority', source: sourceA }
    const second: NarrativeTagValue = { ...first, source: sourceB }
    await seedTags({ [field]: [first, second] })
    const opened = await openSlot(['1', '2'], ['111', '211'])
    try {
      await saveProfile(opened.rawBody, ['1', '2'], ['111', '211'])
      expect(await getPersistedTextFieldTags(requireNarrativeTagsRouteDatabase(db), extensionKey, 'applicantrecipient', '99'))
        .toMatchObject({ [field]: [first, second] })
      await saveProfile(payload({ [field]: [second] }, ['1:11', '1:agency', '2:21', '2:agency']), ['1', '2'], ['111', '211'])
      expect(await storedTags()).toMatchObject({ [field]: [second] })
    } finally { opened.wrapper.unmount() }
  })

  it.each([false, true])('persists the remaining exact sourced tag after actual chip removal (predefined=%s)', async predefined => {
    const first: NarrativeTagValue = predefined ? { predefined: true, key: 'priority', label: 'Priority', source: sourceA } : tagA
    const second: NarrativeTagValue = predefined ? { predefined: true, key: 'priority', label: 'Priority', source: sourceB } : tagB
    await seedTags({ [field]: [first, second] })
    await saveProfile(payload({ [field]: [first, second] }, ['1:11', '1:agency', '2:21', '2:agency']), ['1', '2'], ['111', '211'])
    const opened = await openSlot(['1', '2'], ['111', '211'], true)
    try {
      expect(opened.wrapper.findAll('[data-delete-index]')).toHaveLength(2)
      await opened.wrapper.get('[data-delete-index="0"]').trigger('click')
      await flushPromises()
      await saveProfile(opened.rawBody, ['1', '2'], ['111', '211'])
      expect(await storedTags()).toMatchObject({ [field]: [second] })
    } finally { opened.wrapper.unmount() }
  })

  it('applies visible updates and additions without changing retained hidden metadata or omitted fields', async () => {
    const hidden = { ...tagB, retainedMetadata: { authored: true } }
    await seedTags({ [field]: [tagA, hidden], [`${field}:fr`]: [tagB], other: { retained: true } })
    await saveProfile(payload({ [field]: [{ ...tagA, label: 'Updated A' }, { predefined: false, label: 'New A', source: sourceA }] }))
    expect(await storedTags()).toMatchObject({
      [field]: [hidden, { label: 'Updated A', source: sourceA }, { label: 'New A', source: sourceA }],
      [`${field}:fr`]: [tagB], other: { retained: true }
    })
  })

  it.each([{}, { extensions: {} }, payload({})])('does not touch KV for absent or empty extension fields: %j', async rawBody => {
    const original = { [field]: [tagA, tagB], other: 'unprojectable retained field' }
    await seedTags(original)
    queries.length = 0
    await saveProfile(rawBody)
    expect(await storedTags()).toEqual(original)
    expect(queries.filter(query => /^(update|insert into) "extensions"\."kv_entry"/i.test(query))).toEqual([])
  })

  it.each([sourceB, { agencyId: '1', streamId: '12' }])('rejects hidden source injection and rolls back the profile and KV: %j', async source => {
    await seedTags({ [field]: [tagA, tagB] })
    await expect(saveProfile(payload({ [field]: [{ predefined: false, label: 'Injected', source }] })))
      .rejects.toMatchObject({ code: 'GCS_NARRATIVE_TAGS_INVALID_TAGS' })
    expect(await storedTags()).toEqual({ [field]: [tagA, tagB] })
    expect(await db.selectFrom('Applicant_Recipient_Profile').select('egcs_ar_description_en').executeTakeFirst())
      .toEqual({ egcs_ar_description_en: 'Original description' })
  })

  it('rejects a submitted source outside the fresh contribution Agencies even when Agreement reads permit it', async () => {
    await seedTags({ [field]: [tagA, tagB] })
    await expect(saveProfile(payload({ [field]: [tagB] }), ['1'], ['111', '211']))
      .rejects.toMatchObject({ code: 'GCS_NARRATIVE_TAGS_INVALID_TAGS' })
    expect(await storedTags()).toEqual({ [field]: [tagA, tagB] })
  })

  it('inserts an unauthored map and retains it unchanged on repeated identical saves', async () => {
    await saveProfile(payload({ [field]: [tagA] }))
    const first = await storedTags()
    await saveProfile(payload({ [field]: [tagA] }))
    await saveProfile(payload({ [field]: [tagA] }))
    expect(await storedTags()).toEqual(first)
    expect(await db.selectFrom('extensions.kv_entry').select('id').execute()).toHaveLength(1)
  })

  it('keeps supported unsourced and locale-qualified values under their existing projection policy', async () => {
    const unsourced: NarrativeTagValue = { predefined: true, key: 'community-benefit', label: 'Community benefit' }
    await seedTags({ [`${field}:en`]: [unsourced, tagB], [`${field}:fr`]: [tagB] })
    expect((await readTags('1', ['111'])).tags).toEqual([unsourced])
    await saveProfile(payload({ [`${field}:en`]: [unsourced] }))
    expect(await storedTags()).toEqual({ [`${field}:en`]: [tagB, unsourced], [`${field}:fr`]: [tagB] })
    await saveProfile(payload({ [`${field}:en`]: [] }))
    expect(await storedTags()).toEqual({ [`${field}:en`]: [tagB], [`${field}:fr`]: [tagB] })
  })

  it('preserves the existing field-key contract without treating object prototype names as stored fields', async () => {
    await seedTags({ [field]: [tagB] })
    await saveProfile(payload({ constructor: [tagA] }))
    expect(await storedTags()).toMatchObject({ [field]: [tagB], constructor: [tagA] })
  })

  it('rolls back a failed transaction, then merges the latest retained sources on retry', async () => {
    await seedTags({ [field]: [tagA, tagB] })
    const edited = { ...tagA, label: 'Retried A edit' }
    await expect(saveProfile(payload({ [field]: [edited] }), ['1'], ['111'], async () => { throw new Error('Simulated downstream failure') }))
      .rejects.toThrow('Simulated downstream failure')
    expect(await storedTags()).toEqual({ [field]: [tagA, tagB] })
    await saveProfile(payload({ [field]: [{ ...tagB, label: 'Newer B edit' }] }, ['2:21', '2:agency']), ['2'], ['211'])
    await saveProfile(payload({ [field]: [edited] }))
    expect(await storedTags()).toMatchObject({ [field]: [{ label: 'Newer B edit' }, edited] })
  })

  it('serializes two admitted source edits at the existing Proponent aggregate transaction boundary', async () => {
    await seedTags({ [field]: [tagA, tagB] })
    // Both editors read before either save. PGlite serializes transactions on its one connection;
    // a separate PostgreSQL run is required to certify independent-connection row-lock contention.
    const openedA = await openSlot()
    openedA.wrapper.unmount()
    const openedB = await openSlot(['2'], ['211'])
    openedB.wrapper.unmount()
    let releaseFirst = () => {}
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })
    let firstMerged = () => {}
    const merged = new Promise<void>(resolve => { firstMerged = resolve })
    const first = saveProfile(payload({ [field]: [{ ...tagA, label: 'Concurrent A' }] }), ['1'], ['111'], async () => {
      firstMerged()
      await firstGate
    })
    await merged
    let secondSettled = false
    const second = saveProfile(payload({ [field]: [{ ...tagB, label: 'Concurrent B' }] }, ['2:21', '2:agency']), ['2'], ['211'])
      .then(() => { secondSettled = true })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(secondSettled).toBe(false)
    releaseFirst()
    await Promise.all([first, second])
    expect(await storedTags()).toMatchObject({ [field]: [{ label: 'Concurrent A' }, { label: 'Concurrent B' }] })
  })

  it('retains unprojectable array entries and untouched corrupt fields without cleaning them up', async () => {
    const invalidItems = ['legacy string unsupported by this field reader', null, { predefined: false, source: sourceA }]
    await seedTags({ [field]: [tagA, tagB, ...invalidItems], untouched: 42 })
    await saveProfile(payload({ [field]: [] }))
    expect(await storedTags()).toEqual({ [field]: [tagB, ...invalidItems], untouched: 42 })
  })

  it.each([null, [], 'corrupt root', { [field]: 'corrupt field' }])('rejects an unmergeable retained shape without data loss: %j', async stored => {
    await seedTags(stored)
    await expect(saveProfile(payload({ [field]: [] })))
      .rejects.toMatchObject({ code: 'GCS_NARRATIVE_TAGS_PERSISTED_TAGS_INVALID', statusCode: 500 })
    expect(await storedTags()).toEqual(stored)
  })

  it('does not create a KV row for a sparse empty merge', async () => {
    await mergePersistedProponentTextFieldTags(requireNarrativeTagsRouteDatabase(db), extensionKey, '99', [], {})
    expect(await storedTags()).toBeUndefined()
  })
})
