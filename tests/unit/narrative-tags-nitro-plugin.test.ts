import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveSourcesMock = vi.hoisted(() => vi.fn())
const validateRequestedTagsMock = vi.hoisted(() => vi.fn())
const validateRequestedSourceTagsMock = vi.hoisted(() => vi.fn())
const setPersistedNarrativeTagsMock = vi.hoisted(() => vi.fn())
const setPersistedTextFieldTagsMock = vi.hoisted(() => vi.fn())

vi.mock('@gcs-ssc/extensions/server', () => ({
  defineGcsExtensionNitroPlugin: (callback: unknown) => callback,
  getGcsExtensionHookDatabase: (payload: { db?: unknown }) => payload.db
}))

vi.mock('../../server/narrative-tags-route', () => ({
  NARRATIVE_TAGS_EXTENSION_KEY: 'gcs-narrative-tags',
  NARRATIVE_TAGS_PROPONENT_OWNER_TYPE: 'applicantrecipient',
  createAgreementReadPredicate: () => 'agreement-predicate',
  requireNarrativeTagsRouteDatabase: (db: unknown) => db,
  resolveProponentNarrativeTagSources: (...args: unknown[]) => resolveSourcesMock(...args),
  setPersistedNarrativeTags: (...args: unknown[]) => setPersistedNarrativeTagsMock(...args),
  setPersistedTextFieldTags: (...args: unknown[]) => setPersistedTextFieldTagsMock(...args),
  validateRequestedSourceTags: (...args: unknown[]) => validateRequestedSourceTagsMock(...args),
  validateRequestedTags: (...args: unknown[]) => validateRequestedTagsMock(...args)
}))

vi.mock('../../server/errors', () => ({
  createNarrativeTagsUserError: (code: string, path: string) => Object.assign(new Error(code), { code, path })
}))

vi.mock('../../components/narrative-tags', () => ({
  normalizeNarrativeTagsConfig: (value: unknown) => value
}))

type Hook = (payload: Record<string, unknown>) => Promise<void>

const loadHooks = async (row: Record<string, unknown> | undefined = { enabled: true, config: {} }) => {
  const hooks: Record<string, Hook> = {}
  const plugin = (await import('../../server/nitro-plugin')).default as (app: {
    hooks: { hook: (name: string, callback: Hook) => void }
  }) => void
  plugin({ hooks: { hook: (name, callback) => { hooks[name] = callback } } })
  const query = new Proxy({}, {
    get: (_target, property) => property === 'executeTakeFirst'
      ? async () => row
      : () => query
  })
  const db = { selectFrom: vi.fn(() => query) }
  return { hooks, db }
}

describe('narrative tags Nitro hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    validateRequestedTagsMock.mockImplementation((_config, value) => value)
    validateRequestedSourceTagsMock.mockImplementation((_sources, value) => value)
    resolveSourcesMock.mockResolvedValue([{ source: {}, config: {} }])
  })

  it('registers the same agreement persistence handler for create and update', async () => {
    const { hooks } = await loadHooks()
    expect(hooks['agreement:profile:created']).toBe(hooks['agreement:profile:updated'])
    expect(hooks['applicantrecipient:profile:updated']).toBeTypeOf('function')
  })

  it('ignores agreement updates without tag payloads or an enabled stream', async () => {
    const { hooks, db } = await loadHooks()
    await hooks['agreement:profile:updated']!({ db, rawBody: {} })
    expect(db.selectFrom).not.toHaveBeenCalled()

    const disabled = await loadHooks({ enabled: false, config: {} })
    await disabled.hooks['agreement:profile:updated']!({
      db: disabled.db,
      agreementId: '1',
      streamId: '2',
      rawBody: { extensions: { 'gcs-narrative-tags': { agreementDescriptionTags: [] } } }
    })
    expect(setPersistedNarrativeTagsMock).not.toHaveBeenCalled()
  })

  it('validates and persists agreement description and bilingual text-field tags', async () => {
    const { hooks, db } = await loadHooks({ enabled: true, config: { marker: true } })
    const requested = [{ predefined: true, key: 'tag' }]
    const textFields = {
      'agreement.description:en': requested,
      'agreement.description:fr': requested
    }

    await hooks['agreement:profile:created']!({
      db,
      agreementId: 'agreement-1',
      streamId: 'stream-1',
      rawBody: {
        extensions: {
          'gcs-narrative-tags': {
            agreementDescriptionTags: requested,
            textFieldTags: textFields
          }
        }
      }
    })

    expect(validateRequestedTagsMock).toHaveBeenCalledWith({ marker: true }, requested)
    expect(validateRequestedTagsMock).toHaveBeenCalledWith({ marker: true }, requested, 'en')
    expect(validateRequestedTagsMock).toHaveBeenCalledWith({ marker: true }, requested, 'fr')
    expect(setPersistedNarrativeTagsMock).toHaveBeenCalledWith(
      db, 'gcs-narrative-tags', 'agreement-1', requested
    )
    expect(setPersistedTextFieldTagsMock).toHaveBeenCalledWith(
      db, 'gcs-narrative-tags', 'fundingcaseagreement', 'agreement-1', textFields
    )
  })

  it('persists text fields without replacing absent agreement description tags', async () => {
    const { hooks, db } = await loadHooks()
    const textFields = { 'agreement.description:en': [] }

    await hooks['agreement:profile:updated']!({
      db,
      agreementId: 'agreement-1',
      streamId: 'stream-1',
      rawBody: { extensions: { 'gcs-narrative-tags': { textFieldTags: textFields } } }
    })

    expect(setPersistedNarrativeTagsMock).not.toHaveBeenCalled()
    expect(setPersistedTextFieldTagsMock).toHaveBeenCalled()
  })

  it.each([
    { field: 'agreementDescriptionTags', value: ['invalid'], expectedPath: 'extensions.gcs-narrative-tags.agreementDescriptionTags' },
    { field: 'textFieldTags', value: { 'agreement.description:en': ['invalid'] }, expectedPath: 'extensions.gcs-narrative-tags.textFieldTags' }
  ])('rejects invalid agreement $field', async ({ field, value, expectedPath }) => {
    validateRequestedTagsMock.mockReturnValue(null)
    const { hooks, db } = await loadHooks()

    await expect(hooks['agreement:profile:updated']!({
      db,
      agreementId: 'agreement-1',
      streamId: 'stream-1',
      rawBody: { extensions: { 'gcs-narrative-tags': { [field]: value } } }
    })).rejects.toMatchObject({ code: 'GCS_NARRATIVE_TAGS_INVALID_TAGS', path: expectedPath })
  })

  it('ignores proponent updates without text fields or readable sources', async () => {
    const { hooks, db } = await loadHooks()
    await hooks['applicantrecipient:profile:updated']!({ db, rawBody: {} })
    expect(resolveSourcesMock).not.toHaveBeenCalled()

    resolveSourcesMock.mockResolvedValueOnce([])
    await hooks['applicantrecipient:profile:updated']!({
      db,
      agencyId: 'agency-1',
      applicantRecipientId: 'recipient-1',
      rawBody: { extensions: { 'gcs-narrative-tags': { textFieldTags: {} } } }
    })
    expect(setPersistedTextFieldTagsMock).not.toHaveBeenCalled()
  })

  it('validates and persists proponent text fields against readable sources', async () => {
    const { hooks, db } = await loadHooks()
    const requested = [{ predefined: true, key: 'tag' }]
    await hooks['applicantrecipient:profile:updated']!({
      db,
      agencyId: 'agency-1',
      applicantRecipientId: 'recipient-1',
      agreementAccess: {},
      rawBody: {
        extensions: {
          'gcs-narrative-tags': {
            textFieldTags: {
              'proponent.description:fr': requested,
              'proponent.description:en': requested
            }
          }
        }
      }
    })

    expect(validateRequestedSourceTagsMock).toHaveBeenCalledWith(
      expect.any(Array), requested, 'fr', 'proponent.description'
    )
    expect(validateRequestedSourceTagsMock).toHaveBeenCalledWith(
      expect.any(Array), requested, 'en', 'proponent.description'
    )
    expect(setPersistedTextFieldTagsMock).toHaveBeenCalledWith(
      db, 'gcs-narrative-tags', 'applicantrecipient', 'recipient-1', expect.any(Object)
    )
  })

  it('rejects invalid proponent text fields', async () => {
    validateRequestedSourceTagsMock.mockReturnValue(null)
    const { hooks, db } = await loadHooks()

    await expect(hooks['applicantrecipient:profile:updated']!({
      db,
      agencyId: 'agency-1',
      applicantRecipientId: 'recipient-1',
      rawBody: {
        extensions: { 'gcs-narrative-tags': { textFieldTags: { 'proponent.description:en': ['invalid'] } } }
      }
    })).rejects.toMatchObject({
      code: 'GCS_NARRATIVE_TAGS_INVALID_TAGS', path: 'extensions.gcs-narrative-tags.textFieldTags'
    })
  })
})
