import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GcsExtensionRouteEvent } from '@gcs-ssc/extensions/server'
import { createEvent } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import extensionDefinition from '../../extension.config'
import getProponentTagsHandler from '../../server/api/extensions/gcs-narrative-tags/agencies/[agencyId]/applicant-recipients/[applicantRecipientId]/tags.get'
import getTagsHandler from '../../server/api/extensions/gcs-narrative-tags/streams/[streamId]/agreements/[agreementId]/tags.get'
import patchTagsHandler from '../../server/api/extensions/gcs-narrative-tags/streams/[streamId]/agreements/[agreementId]/tags.patch'
import {
  getNarrativeTagsTargetConfig,
  narrativeTagSourceLabel,
  normalizeNarrativeTagsConfig,
  normalizeNarrativeTagValues,
  rankTagsByKeywordOverlap,
  resolveNarrativeTagsDescriptionsContext,
  resolveNarrativeTagsEntityTarget,
  toNarrativeTagsJson
} from '../../components/narrative-tags'
import {
  getPersistedNarrativeTags,
  requireNarrativeTagsRouteDatabase,
  resolveProponentNarrativeTagSources,
  resolveNarrativeTagsRouteContext,
  setPersistedNarrativeTags,
  type NarrativeTagsRouteDatabase,
  validateRequestedSourceTags,
  validateRequestedTags
} from '../../server/narrative-tags-route'

const readBodyMock = vi.hoisted(() => vi.fn())

vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof import('h3')>('h3')

  return {
    ...actual,
    readBody: (...args: unknown[]) => readBodyMock(...args)
  }
})

const createQueryChain = (executeTakeFirstResult?: Record<string, unknown>, executeResult: Array<Record<string, unknown>> = []) => {
  const chain = {
    innerJoin: () => chain,
    leftJoin: () => chain,
    select: () => chain,
    where: () => chain,
    distinct: () => chain,
    values: () => chain,
    set: () => chain,
    returningAll: () => chain,
    execute: async () => executeResult,
    executeTakeFirst: async () => executeTakeFirstResult
  }
  return chain
}

const createRouteDatabase = (
  overrides: Partial<NarrativeTagsRouteDatabase> = {}
): NarrativeTagsRouteDatabase => ({
  selectFrom: () => createQueryChain(),
  insertInto: () => createQueryChain(),
  updateTable: () => createQueryChain(),
  ...overrides
})

const createRouteEvent = (
  context: GcsExtensionRouteEvent['context']
): GcsExtensionRouteEvent => {
  const request = new IncomingMessage(new Socket())
  request.method = 'PATCH'

  return Object.assign(
    createEvent(request, new ServerResponse(request)),
    { context }
  )
}

describe('gcs narrative tags extension', () => {
  it('declares stream configuration, runtime slot, static assets, and extension routes', () => {
    expect(extensionDefinition.key).toBe('gcs-narrative-tags')
    expect(extensionDefinition.admin?.streamConfig?.path).toBe('./components/NarrativeTagsConfig.vue')
    expect(extensionDefinition.client?.slots?.map(slot => slot.slot)).toEqual([
      'agreement.descriptions.after',
      'proponent.descriptions.after'
    ])
    expect(extensionDefinition.nitroPlugin).toBe('./server/nitro-plugin.ts')
    expect(extensionDefinition.runtime?.path).toBe('./server/runtime.ts')
    expect(extensionDefinition.assets).toEqual([
      {
        path: './client',
        baseURL: '/extensions/gcs-narrative-tags/client'
      },
      {
        package: '@browser-tag-extractor/core',
        packagePath: 'models',
        baseURL: '/extensions/gcs-narrative-tags/models'
      }
    ])
    expect(extensionDefinition.serverHandlers?.map(handler => handler.route)).toEqual([
      '/streams/[streamId]/agreements/[agreementId]/tags',
      '/streams/[streamId]/agreements/[agreementId]/tags',
      '/agencies/[agencyId]/applicant-recipients/[applicantRecipientId]/tags'
    ])
  })

  it('normalizes config and drops duplicate or invalid tag keys', () => {
    const config = normalizeNarrativeTagsConfig({
      enabled: false,
      minScore: 2,
      maxSuggestions: '3',
      tags: [
        {
          key: ' Community Benefit ',
          label: { en: 'Community', fr: 'Collectivité' },
          description: { en: 'Public benefit', fr: 'Avantage public' },
          aliases: [' community ', 'community'],
          color: 'success'
        },
        {
          key: 'community-benefit',
          label: { en: 'Duplicate', fr: 'Doublon' }
        },
        {
          key: '',
          label: { en: '', fr: '' }
        }
      ]
    })
    const agreementTargetConfig = getNarrativeTagsTargetConfig(config, 'agreement.description')

    expect(config.enabled).toBe(false)
    expect(agreementTargetConfig.allowCustomTags).toBe(false)
    expect(agreementTargetConfig.allowDynamicTagSuggestions).toBe(false)
    expect(agreementTargetConfig.minScore).toBe(1)
    expect(agreementTargetConfig.maxSuggestions).toBe(3)
    expect(config.tags).toEqual([{
      key: 'community-benefit',
      label: { en: 'Community', fr: 'Collectivité' },
      description: { en: 'Public benefit', fr: 'Avantage public' },
      aliases: ['community'],
      color: 'success'
    }])
    expect(toNarrativeTagsJson(config).tags).toHaveLength(1)
  })

  it('normalizes independent settings for each target field', () => {
    const config = normalizeNarrativeTagsConfig({
      allowCustomTags: true,
      maxSuggestions: 2,
      targets: {
        'agreement.description': false,
        'proponent.description': {
          enabled: true,
          allowCustomTags: false,
          maxSuggestions: 5
        }
      }
    })

    expect(getNarrativeTagsTargetConfig(config, 'agreement.description')).toMatchObject({
      enabled: false,
      allowCustomTags: true,
      maxSuggestions: 2
    })
    expect(getNarrativeTagsTargetConfig(config, 'proponent.description')).toMatchObject({
      enabled: true,
      allowCustomTags: false,
      maxSuggestions: 5
    })
    expect(toNarrativeTagsJson(config).targets).toMatchObject({
      'agreement.description': {
        enabled: false,
        allowCustomTags: true,
        maxSuggestions: 2
      },
      'proponent.description': {
        enabled: true,
        allowCustomTags: false,
        maxSuggestions: 5
      }
    })
  })

  it('resolves shared agreement descriptions contexts with English and French text', () => {
    expect(resolveNarrativeTagsDescriptionsContext({
      kind: 'agreement.descriptions',
      descriptions: {
        en: ' Infrastructure project ',
        fr: ' Projet '
      },
      streamId: '31',
      agreementId: '44'
    })).toEqual({
      kind: 'agreement.descriptions',
      descriptions: {
        en: 'Infrastructure project',
        fr: 'Projet'
      },
      streamId: '31',
      agreementId: '44',
      agencyId: '',
      applicantRecipientId: '',
      extensions: {},
      setExtensionPayload: undefined
    })

    expect(resolveNarrativeTagsDescriptionsContext({
      textarea: {
        kind: 'agreement.description',
        text: 'Projet'
      }
    })).toBeNull()
  })

  it('resolves entity targets from bilingual description slot contexts', () => {
    expect(resolveNarrativeTagsEntityTarget({
      kind: 'agreement.descriptions',
      descriptions: {
        en: ' Infrastructure project ',
        fr: ' Projet communautaire '
      },
      streamId: '31',
      agreementId: '44'
    })).toMatchObject({
      targetKey: 'agreement.description',
      text: 'Infrastructure project\n\nProjet communautaire',
      streamId: '31',
      ownerType: 'fundingcaseagreement',
      ownerId: '44'
    })

    expect(resolveNarrativeTagsEntityTarget({
      kind: 'proponent.descriptions',
      descriptions: {
        en: 'Local training organization',
        fr: 'Organisme local de formation'
      },
      agencyId: '1',
      applicantRecipientId: '2'
    })).toMatchObject({
      targetKey: 'proponent.description',
      text: 'Local training organization\n\nOrganisme local de formation',
      agencyId: '1',
      ownerType: 'applicantrecipient',
      ownerId: '2'
    })
  })

  it('ranks only predefined tags without inventing new labels', () => {
    const config = normalizeNarrativeTagsConfig({})
    const ranked = rankTagsByKeywordOverlap(
      'This agreement funds equipment for a local facility and capital project.',
      config.tags,
      2
    )

    expect(ranked.flatMap(item => item.predefined ? [item.key] : [])).toContain('infrastructure')
    expect(ranked.every(item => item.predefined && config.tags.some(tag => tag.key === item.key))).toBe(true)
  })

  it('suggests capacity building for the training regression sentence', () => {
    const config = normalizeNarrativeTagsConfig({})
    const ranked = rankTagsByKeywordOverlap(
      'We are looking to increase the trainers ability to perform tasks by providing them training',
      config.tags,
      2
    )

    expect(ranked[0]?.predefined ? ranked[0].key : '').toBe('capacity-building')
  })

  it('validates persisted tags against stream configuration', () => {
    const config = normalizeNarrativeTagsConfig({})

    expect(validateRequestedTags(config, [' infrastructure '])).toEqual([{
      predefined: true,
      key: 'infrastructure',
      label: 'Infrastructure'
    }])
    expect(validateRequestedTags(config, ['infrastructure', 'infrastructure'])).toBeNull()
    expect(validateRequestedTags(config, ['invented-tag'])).toBeNull()
    expect(validateRequestedTags(config, ['infrastructure', 'capacity-building', 'community-benefit', 'extra'])).toBeNull()
    expect(validateRequestedTags(config, 'infrastructure')).toBeNull()
  })

  it('validates agreement tags against only the agreement stream configuration', () => {
    const config = normalizeNarrativeTagsConfig({
      tags: [{
        key: 'parent-stream-tag',
        label: { en: 'Parent stream tag', fr: 'Etiquette du volet parent' },
        description: { en: 'Available on the agreement parent stream only.', fr: 'Disponible seulement sur le volet parent.' },
        aliases: [],
        color: 'primary'
      }]
    })

    expect(validateRequestedTags(config, ['parent-stream-tag'])).toEqual([{
      predefined: true,
      key: 'parent-stream-tag',
      label: 'Parent stream tag'
    }])
    expect(validateRequestedTags(config, ['cross-agency-tag'])).toBeNull()
  })

  it('uses agency abbreviations when displaying tag source labels', () => {
    expect(narrativeTagSourceLabel({
      agencyId: '1',
      agencyName: { en: 'Health Canada', fr: 'Sante Canada' },
      agencyAbbreviation: { en: 'HC', fr: 'SC' },
      streamId: '31',
      streamName: { en: 'Core Stream', fr: 'Volet principal' }
    }, 'en')).toBe('HC / Core Stream')
  })

  it('validates predefined and custom agreement-level typed tags', () => {
    const config = normalizeNarrativeTagsConfig({ allowCustomTags: true })

    expect(normalizeNarrativeTagValues(config, [
      { predefined: true, key: 'capacity-building', label: 'ignored client label' },
      { predefined: false, label: ' Local priority ' }
    ])).toEqual([
      {
        predefined: true,
        key: 'capacity-building',
        label: 'Capacity building'
      },
      {
        predefined: false,
        label: 'Local priority'
      }
    ])
  })

  it('preserves source provenance on validated proponent tags', () => {
    const source = {
      agencyId: '2',
      agencyName: { en: 'Agency Two', fr: 'Agence Deux' },
      agencyAbbreviation: { en: 'A2', fr: 'A2' },
      streamId: '31',
      streamName: { en: 'Stream A', fr: 'Volet A' }
    }
    const config = normalizeNarrativeTagsConfig({
      targets: {
        'proponent.description': {
          enabled: true,
          allowCustomTags: true
        }
      },
      tags: [{
        key: 'community-benefit',
        label: { en: 'Community benefit', fr: 'Avantage communautaire' },
        description: { en: 'Community', fr: 'Communautaire' },
        aliases: [],
        color: 'success'
      }]
    })

    expect(validateRequestedSourceTags([{
      source,
      config
    }], [
      {
        predefined: true,
        key: 'community-benefit',
        label: 'Ignored',
        source
      },
      {
        predefined: false,
        label: ' Local priority ',
        source
      }
    ], 'en', 'proponent.description')).toEqual([
      {
        predefined: true,
        key: 'community-benefit',
        label: 'Community benefit',
        source
      },
      {
        predefined: false,
        label: 'Local priority',
        source
      }
    ])
  })

  it('resolves proponent tag sources from lead agency enablement and linked stream configuration', async () => {
    const profileQuery = createQueryChain({
      applicant_recipient_id: '9',
      lead_agency_id: '1',
      agency_name_en: 'Lead Agency',
      agency_name_fr: 'Agence responsable',
      agency_abbreviation_en: 'LA',
      agency_abbreviation_fr: 'AR'
    })
    const leadAgencyQuery = createQueryChain({ enabled: true })
    const linkedStreamsQuery = createQueryChain(undefined, [{
      agency_id: '2',
      agency_name_en: 'Partner Agency',
      agency_name_fr: 'Agence partenaire',
      agency_abbreviation_en: 'PA',
      agency_abbreviation_fr: 'AP',
      stream_id: '31',
      stream_name_en: 'Partner Stream',
      stream_name_fr: 'Volet partenaire',
      config: {
        enabled: true,
        tags: [{
          key: 'infrastructure',
          label: { en: 'Infrastructure', fr: 'Infrastructure' },
          description: { en: 'Capital', fr: 'Immobilisations' },
          aliases: [],
          color: 'neutral'
        }]
      }
    }])
    const db = createRouteDatabase({
      selectFrom: vi.fn()
        .mockReturnValueOnce(profileQuery)
        .mockReturnValueOnce(leadAgencyQuery)
        .mockReturnValueOnce(linkedStreamsQuery)
    })

    await expect(resolveProponentNarrativeTagSources(db, 'gcs-narrative-tags', '1', '9')).resolves.toMatchObject([
      {
        source: {
          agencyId: '1',
          agencyName: {
            en: 'Lead Agency',
            fr: 'Agence responsable'
          },
          agencyAbbreviation: {
            en: 'LA',
            fr: 'AR'
          }
        }
      },
      {
        source: {
          agencyId: '2',
          agencyAbbreviation: {
            en: 'PA',
            fr: 'AP'
          },
          streamId: '31',
          streamName: {
            en: 'Partner Stream',
            fr: 'Volet partenaire'
          }
        },
        config: {
          tags: [{
            key: 'infrastructure'
          }]
        }
      }
    ])
  })

  it('resolves route context only for this extension and authorized agreement stream pairs', async () => {
    const agreementQuery = createQueryChain({
      agreement_id: '44',
      stream_id: '31',
      profile_id: '22',
      agency_id: '1'
    })
    const configQuery = createQueryChain({
      enabled: true,
      config: {
        enabled: true
      }
    })
    const db = createRouteDatabase({
      selectFrom: vi.fn()
        .mockReturnValueOnce(agreementQuery)
        .mockReturnValueOnce(configQuery)
    })
    const authContext = {
      userId: 'user-1',
      userAbilities: {
        authorizeWithTeam: vi.fn(async () => false),
        authorize: vi.fn(() => true)
      }
    }

    await expect(resolveNarrativeTagsRouteContext({
      context: {
        $db: db,
        $authContext: authContext,
        params: {
          extensionKey: 'gcs-narrative-tags',
          streamId: '31',
          agreementId: '44'
        }
      }
    }, 'read')).resolves.toMatchObject({
      extensionKey: 'gcs-narrative-tags',
      streamId: '31',
      agreementId: '44',
      agencyId: '1',
      profileId: '22'
    })
    expect(authContext.userAbilities.authorizeWithTeam).toHaveBeenCalledWith(
      'agreement',
      'read',
      expect.objectContaining({
        path: expect.arrayContaining([{ type: 'fundingcaseagreement', id: '44' }])
      }),
      'user-1',
      true,
      db
    )
  })

  it('throws instead of returning pretend success objects for invalid extension routes', async () => {
    const db = {
      selectFrom: vi.fn()
    }

    await expect(resolveNarrativeTagsRouteContext({
      context: {
        $db: db,
        params: {
          extensionKey: 'other-extension',
          streamId: '31',
          agreementId: '44'
        }
      }
    }, 'read')).rejects.toMatchObject({
      statusCode: 404,
      code: 'GCS_NARRATIVE_TAGS_EXTENSION_NOT_FOUND',
      localizedMessage: {
        en: 'The narrative tags extension route could not be found.',
        fr: 'La route de l extension des etiquettes narratives est introuvable.'
      }
    })
    expect(db.selectFrom).not.toHaveBeenCalled()
  })

  it('reads and upserts narrative tags through extension-owned KV rows', async () => {
    const readQuery = createQueryChain({ value: ['infrastructure', 3, 'community-benefit'] })
    const missingQuery = createQueryChain()
    const insertQuery = createQueryChain({ id: 'created' })
    const existingQuery = createQueryChain({ id: 'existing' })
    const updateQuery = createQueryChain({ id: 'existing', value: ['capacity-building'] })
    const db = createRouteDatabase({
      selectFrom: vi.fn()
        .mockReturnValueOnce(readQuery)
        .mockReturnValueOnce(missingQuery)
        .mockReturnValueOnce(existingQuery),
      insertInto: vi.fn(() => insertQuery),
      updateTable: vi.fn(() => updateQuery)
    })

    await expect(getPersistedNarrativeTags(db, 'gcs-narrative-tags', '44')).resolves.toEqual([
      { predefined: true, key: 'infrastructure', label: 'infrastructure' },
      { predefined: true, key: 'community-benefit', label: 'community-benefit' }
    ])
    await expect(setPersistedNarrativeTags(db, 'gcs-narrative-tags', '44', [{ predefined: true, key: 'infrastructure', label: 'Infrastructure' }])).resolves.toEqual({ id: 'created' })
    await expect(setPersistedNarrativeTags(db, 'gcs-narrative-tags', '44', [{ predefined: true, key: 'capacity-building', label: 'Capacity building' }])).resolves.toEqual({
      id: 'existing',
      value: ['capacity-building']
    })
    expect(db.insertInto).toHaveBeenCalledWith('extensions.kv_entry')
    expect(db.updateTable).toHaveBeenCalledWith('extensions.kv_entry')
  })

  it('filters persisted tags in the get route and rejects invalid patch route payloads', async () => {
    const agreementQuery = createQueryChain({
      agreement_id: '44',
      stream_id: '31',
      profile_id: '22',
      agency_id: '1'
    })
    const configQuery = createQueryChain({
      enabled: true,
      config: {
        enabled: true,
        tags: [{
          key: 'infrastructure',
          label: { en: 'Infrastructure', fr: 'Infrastructure' },
          description: { en: '', fr: '' },
          aliases: [],
          color: 'neutral'
        }]
      }
    })
    const tagsQuery = createQueryChain({
      value: ['infrastructure', 'deleted-tag']
    })
    const textFieldTagsQuery = createQueryChain()
    const event = createRouteEvent({
      $db: createRouteDatabase({
        selectFrom: vi.fn()
          .mockReturnValueOnce(agreementQuery)
          .mockReturnValueOnce(configQuery)
          .mockReturnValueOnce(tagsQuery)
          .mockReturnValueOnce(textFieldTagsQuery)
          .mockReturnValueOnce(agreementQuery)
          .mockReturnValueOnce(configQuery)
      }),
      $authContext: {
        userId: 'user-1',
        userAbilities: {
          authorizeWithTeam: vi.fn(async () => true),
          authorize: vi.fn(() => false)
        }
      },
      params: {
        extensionKey: 'gcs-narrative-tags',
        streamId: '31',
        agreementId: '44'
      }
    })

    await expect(getTagsHandler(event)).resolves.toEqual({
      tags: [{ predefined: true, key: 'infrastructure', label: 'infrastructure' }],
      textFieldTags: {}
    })

    readBodyMock.mockResolvedValueOnce({
      tags: ['deleted-tag']
    })
    await expect(patchTagsHandler(event)).rejects.toMatchObject({
      statusCode: 400,
      code: 'GCS_NARRATIVE_TAGS_INVALID_TAGS',
      localizedMessage: {
        en: 'Select tags that match the configured narrative tag rules.',
        fr: 'Selectionnez des etiquettes qui respectent les regles configurees.'
      }
    })
  })

  it('loads proponent text field tags from the agency/applicant recipient route', async () => {
    const profileQuery = createQueryChain({
      applicant_recipient_id: '9',
      lead_agency_id: '1',
      agency_name_en: 'Lead Agency',
      agency_name_fr: 'Agence responsable',
      agency_abbreviation_en: 'LA',
      agency_abbreviation_fr: 'AR'
    })
    const leadAgencyQuery = createQueryChain({ enabled: true })
    const linkedStreamsQuery = createQueryChain(undefined, [])
    const textFieldTagsQuery = createQueryChain({
      value: {
        'proponent.description:en': [{ predefined: true, key: 'community', label: 'Community' }]
      }
    })
    const authorize = vi.fn(() => true)
    const event = createRouteEvent({
      $db: createRouteDatabase({
        selectFrom: vi.fn()
          .mockReturnValueOnce(profileQuery)
          .mockReturnValueOnce(leadAgencyQuery)
          .mockReturnValueOnce(linkedStreamsQuery)
          .mockReturnValueOnce(textFieldTagsQuery)
      }),
      $authContext: {
        userId: 'user-1',
        userAbilities: {
          authorize,
          authorizeWithTeam: vi.fn(() => true)
        }
      },
      params: {
        extensionKey: 'gcs-narrative-tags',
        agencyId: '1',
        applicantRecipientId: '9'
      }
    })

    await expect(getProponentTagsHandler(event)).resolves.toMatchObject({
      tags: [{ predefined: true, key: 'community', label: 'Community' }],
      textFieldTags: {
        'proponent.description:en': [{ predefined: true, key: 'community', label: 'Community' }]
      },
      sources: [expect.objectContaining({
        source: expect.objectContaining({
          agencyId: '1'
        })
      })]
    })
    expect(authorize).toHaveBeenCalledWith('applicant_recipient', 'read', {
      type: 'agency',
      agencyId: '1'
    })
  })

  it('rejects proponent tag requests without extension route identifiers', async () => {
    const event = createRouteEvent({
      $db: {},
      $authContext: {
        userId: 'user-1',
        userAbilities: {
          authorize: vi.fn(() => true),
          authorizeWithTeam: vi.fn(() => true)
        }
      },
      params: {
        extensionKey: 'wrong-extension',
        agencyId: '1',
        applicantRecipientId: '9'
      }
    })

    await expect(getProponentTagsHandler(event)).rejects.toMatchObject({
      statusCode: 400,
      code: 'GCS_NARRATIVE_TAGS_MISSING_ROUTE_IDS'
    })
  })

  it('rejects missing host database capabilities at the extension boundary', () => {
    expect(() => requireNarrativeTagsRouteDatabase(undefined)).toThrow(TypeError)
    expect(() => requireNarrativeTagsRouteDatabase({
      selectFrom: vi.fn()
    })).toThrow('Narrative tags requires a queryable host database.')
    expect(requireNarrativeTagsRouteDatabase(createRouteDatabase())).toBeTypeOf('object')
  })

  it('persists profile update hook tags from raw extension payloads', async () => {
    const registeredHooks: Record<string, ((payload: {
      event: {
        context: {
          $db: unknown
        }
      }
      agreementId?: string
      streamId?: string
      applicantRecipientId?: string
      agencyId?: string
      rawBody: Record<string, unknown>
    }) => Promise<void>) | undefined> = {}
    vi.stubGlobal('defineNitroPlugin', (callback: (nitroApp: { hooks: { hook: (name: string, handler: NonNullable<typeof registeredHooks[string]>) => void } }) => void) => callback({
      hooks: {
        hook: (name, handler) => {
          registeredHooks[name] = handler
        }
      }
    }))
    vi.stubGlobal('createError', (value: unknown) => value)

    const configQuery = createQueryChain({
      enabled: true,
      config: {
        enabled: true
      }
    })
    const missingQuery = createQueryChain()
    const insertedValues: unknown[] = []
    const insertQuery = {
      values: vi.fn((value: unknown) => {
        insertedValues.push(value)
        return insertQuery
      }),
      returningAll: vi.fn(() => insertQuery),
      executeTakeFirst: vi.fn(async () => ({ id: 'kv-1' }))
    }
    const db = {
      selectFrom: vi.fn()
        .mockReturnValueOnce(configQuery)
        .mockReturnValueOnce(missingQuery),
      insertInto: vi.fn(() => insertQuery),
      updateTable: vi.fn()
    }

    await import('../../server/nitro-plugin')
    await registeredHooks['agreement:profile:updated']?.({
      event: {
        context: {
          $db: db
        }
      },
      agreementId: '44',
      streamId: '31',
      rawBody: {
        extensions: {
          'gcs-narrative-tags': {
            agreementDescriptionTags: [
              { predefined: true, key: 'capacity-building', label: 'Capacity building' }
            ]
          }
        }
      }
    })

    expect(db.insertInto).toHaveBeenCalledWith('extensions.kv_entry')
    expect(insertedValues[0]).toEqual(expect.objectContaining({
      extension_key: 'gcs-narrative-tags',
      owner_type: 'fundingcaseagreement',
      owner_id: '44',
      value: [
        { predefined: true, key: 'capacity-building', label: 'Capacity building' }
      ]
    }))

    const source = {
      agencyId: '1',
      agencyName: { en: 'Health Canada', fr: 'Sante Canada' },
      agencyAbbreviation: { en: 'HC', fr: 'SC' },
      streamId: '31',
      streamName: { en: 'Core Stream', fr: 'Volet principal' }
    }
    const profileQuery = createQueryChain({
      applicant_recipient_id: '2',
      lead_agency_id: '1',
      agency_name_en: 'Health Canada',
      agency_name_fr: 'Sante Canada',
      agency_abbreviation_en: 'HC',
      agency_abbreviation_fr: 'SC'
    })
    const leadAgencyQuery = createQueryChain()
    const linkedStreamsQuery = createQueryChain(undefined, [{
      agency_id: '1',
      agency_name_en: 'Health Canada',
      agency_name_fr: 'Sante Canada',
      agency_abbreviation_en: 'HC',
      agency_abbreviation_fr: 'SC',
      stream_id: '31',
      stream_name_en: 'Core Stream',
      stream_name_fr: 'Volet principal',
      config: {
        enabled: true,
        targets: {
          'proponent.description': {
            enabled: true,
            allowCustomTags: true
          }
        },
        tags: [{
          key: 'stream-priority',
          label: { en: 'Stream priority', fr: 'Priorite du volet' },
          description: { en: 'Stream sourced', fr: 'Source volet' },
          aliases: [],
          color: 'success'
        }]
      }
    }])
    const proponentMissingQuery = createQueryChain()
    const proponentInsertedValues: unknown[] = []
    const proponentInsertQuery = {
      values: vi.fn((value: unknown) => {
        proponentInsertedValues.push(value)
        return proponentInsertQuery
      }),
      returningAll: vi.fn(() => proponentInsertQuery),
      executeTakeFirst: vi.fn(async () => ({ id: 'kv-2' }))
    }
    const proponentDb = {
      selectFrom: vi.fn()
        .mockReturnValueOnce(profileQuery)
        .mockReturnValueOnce(leadAgencyQuery)
        .mockReturnValueOnce(linkedStreamsQuery)
        .mockReturnValueOnce(proponentMissingQuery),
      insertInto: vi.fn(() => proponentInsertQuery),
      updateTable: vi.fn()
    }

    await registeredHooks['applicantrecipient:profile:updated']?.({
      event: {
        context: {
          $db: proponentDb
        }
      },
      applicantRecipientId: '2',
      agencyId: '1',
      rawBody: {
        extensions: {
          'gcs-narrative-tags': {
            textFieldTags: {
              'proponent.description': [
                { predefined: true, key: 'stream-priority', label: 'Stream priority', source }
              ]
            }
          }
        }
      }
    })

    expect(proponentDb.insertInto).toHaveBeenCalledWith('extensions.kv_entry')
    expect(proponentInsertedValues[0]).toEqual(expect.objectContaining({
      extension_key: 'gcs-narrative-tags',
      owner_type: 'applicantrecipient',
      owner_id: '2',
      config_key: 'text-field-tags',
      value: {
        'proponent.description': [
          { predefined: true, key: 'stream-priority', label: 'Stream priority', source }
        ]
      }
    }))
  })

  it('uses the tag extractor package model assets and a bundled worker configured for local model loading', async () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const workerSource = await readFile(resolve(root, 'client/worker-source.js'), 'utf8')
    const bundledWorker = await readFile(resolve(root, 'client/worker.js'), 'utf8')
    const wasmRuntime = await readFile(resolve(root, 'client/ort-wasm-simd-threaded.asyncify.mjs'), 'utf8')
    const packageConfig = await readFile(resolve(root, 'node_modules/@browser-tag-extractor/core/models/Xenova/all-MiniLM-L12-v2/config.json'), 'utf8')

    expect(workerSource).toContain('@browser-tag-extractor/core/benchmark')
    expect(workerSource).toContain('/extensions/gcs-narrative-tags/models/')
    expect(bundledWorker).toContain('Xenova/all-MiniLM-L12-v2')
    expect(wasmRuntime).toContain('ort-wasm-simd-threaded.asyncify.wasm')
    expect(JSON.parse(packageConfig).model_type).toBe('bert')
  })
})
