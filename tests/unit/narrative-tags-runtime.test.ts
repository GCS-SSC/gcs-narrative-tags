import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireDatabaseMock = vi.hoisted(() => vi.fn((db: unknown) => db))
const resolveSourcesMock = vi.hoisted(() => vi.fn())

vi.mock('../../server/narrative-tags-route.ts', () => ({
  NARRATIVE_TAGS_EXTENSION_KEY: 'gcs-narrative-tags',
  requireNarrativeTagsRouteDatabase: (db: unknown) => requireDatabaseMock(db),
  resolveProponentNarrativeTagSources: (
    db: unknown,
    extensionKey: string,
    leadAgencyId: string,
    applicantRecipientId: string
  ) => resolveSourcesMock(db, extensionKey, leadAgencyId, applicantRecipientId)
}))

describe('narrative tags runtime contribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    { slot: 'agreement.descriptions.after', agencyId: '1', applicantRecipientId: '2' },
    { slot: 'proponent.descriptions.after', agencyId: '', applicantRecipientId: '2' },
    { slot: 'proponent.descriptions.after', agencyId: '1', applicantRecipientId: '' }
  ])('rejects an inapplicable runtime context without querying sources', async context => {
    const runtime = (await import('../../server/runtime')).default

    await expect(runtime({ db: {} } as never, context as never)).resolves.toBeNull()
    expect(resolveSourcesMock).not.toHaveBeenCalled()
  })

  it('returns null when no readable enabled source remains', async () => {
    resolveSourcesMock.mockResolvedValueOnce([])
    const runtime = (await import('../../server/runtime')).default

    await expect(runtime({ db: { marker: true } } as never, {
      slot: 'proponent.descriptions.after', agencyId: '1', applicantRecipientId: '2'
    } as never)).resolves.toBeNull()
    expect(requireDatabaseMock).toHaveBeenCalledWith({ marker: true })
  })

  it('enables the slot when at least one readable source exists', async () => {
    resolveSourcesMock.mockResolvedValueOnce([{ source: {}, config: {} }])
    const runtime = (await import('../../server/runtime')).default

    await expect(runtime({ db: {} } as never, {
      slot: 'proponent.descriptions.after', agencyId: '1', applicantRecipientId: '2'
    } as never)).resolves.toEqual({ enabled: true, config: {} })
    expect(resolveSourcesMock).toHaveBeenCalledWith(
      {}, 'gcs-narrative-tags', '1', '2'
    )
  })
})
