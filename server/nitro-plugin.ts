import { defineGcsExtensionNitroPlugin, getGcsExtensionHookDatabase } from '@gcs-ssc/extensions/server'
import {
  NARRATIVE_TAGS_EXTENSION_KEY,
  NARRATIVE_TAGS_PROPONENT_OWNER_TYPE,
  type NarrativeTagsRouteDatabase,
  resolveProponentNarrativeTagSources,
  setPersistedNarrativeTags,
  setPersistedTextFieldTags,
  validateRequestedSourceTags,
  validateRequestedTags
} from './narrative-tags-route'
import { createNarrativeTagsUserError } from './errors'
import { normalizeNarrativeTagsConfig } from '../components/narrative-tags'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const resolveAgreementDescriptionTags = (rawBody: Record<string, unknown>): unknown => {
  const extensions = isRecord(rawBody.extensions) ? rawBody.extensions : {}
  const extensionPayload = isRecord(extensions[NARRATIVE_TAGS_EXTENSION_KEY])
    ? extensions[NARRATIVE_TAGS_EXTENSION_KEY]
    : {}

  return extensionPayload.agreementDescriptionTags
}

const resolveTextFieldTags = (rawBody: Record<string, unknown>): Record<string, unknown> | null => {
  const extensions = isRecord(rawBody.extensions) ? rawBody.extensions : {}
  const extensionPayload = isRecord(extensions[NARRATIVE_TAGS_EXTENSION_KEY])
    ? extensions[NARRATIVE_TAGS_EXTENSION_KEY]
    : {}

  return isRecord(extensionPayload.textFieldTags) ? extensionPayload.textFieldTags : null
}

const validateTextFieldTags = (
  config: ReturnType<typeof normalizeNarrativeTagsConfig>,
  value: Record<string, unknown>
) => {
  const entries = Object.entries(value)
  const normalized: Record<string, ReturnType<typeof validateRequestedTags>> = {}

  for (const [key, tags] of entries) {
    const locale = key.endsWith(':fr') ? 'fr' : 'en'
    const validatedTags = validateRequestedTags(config, tags, locale)
    if (!validatedTags) {
      return null
    }
    normalized[key] = validatedTags
  }

  return normalized as Record<string, NonNullable<ReturnType<typeof validateRequestedTags>>>
}

const validateProponentTextFieldTags = (
  sources: Awaited<ReturnType<typeof resolveProponentNarrativeTagSources>>,
  value: Record<string, unknown>
) => {
  const entries = Object.entries(value)
  const normalized: Record<string, ReturnType<typeof validateRequestedSourceTags>> = {}

  for (const [key, tags] of entries) {
    const locale = key.endsWith(':fr') ? 'fr' : 'en'
    const validatedTags = validateRequestedSourceTags(sources, tags, locale, 'proponent.description')
    if (!validatedTags) {
      return null
    }
    normalized[key] = validatedTags
  }

  return normalized as Record<string, NonNullable<ReturnType<typeof validateRequestedSourceTags>>>
}

/**
 * Registers profile-update hooks that validate and persist agreement and applicant-recipient narrative tags.
 */
export default defineGcsExtensionNitroPlugin(nitroApp => {
  nitroApp.hooks.hook('agreement:profile:updated', async payload => {
    const requestedTags = resolveAgreementDescriptionTags(payload.rawBody)
    const textFieldTags = resolveTextFieldTags(payload.rawBody)
    if (requestedTags === undefined && !textFieldTags) {
      return
    }

    const db = getGcsExtensionHookDatabase(payload)
    const row = await (db as NarrativeTagsRouteDatabase)
      .selectFrom('extensions.stream_configuration')
      .select(['enabled', 'config'])
      .where('extension_key', '=', NARRATIVE_TAGS_EXTENSION_KEY)
      .where('stream_id', '=', payload.streamId)
      .where('_deleted', '=', false)
      .executeTakeFirst()

    if (row?.enabled !== true) {
      return
    }

    const config = normalizeNarrativeTagsConfig(row.config)
    const tags = requestedTags === undefined ? [] : validateRequestedTags(config, requestedTags)
    if (requestedTags !== undefined && !tags) {
      throw createNarrativeTagsUserError('GCS_NARRATIVE_TAGS_INVALID_TAGS', 'extensions.gcs-narrative-tags.agreementDescriptionTags')
    }

    if (requestedTags !== undefined && tags) {
      await setPersistedNarrativeTags(
        db as never,
        NARRATIVE_TAGS_EXTENSION_KEY,
        payload.agreementId,
        tags
      )
    }

    if (textFieldTags) {
      const normalizedTextFieldTags = validateTextFieldTags(config, textFieldTags)
      if (!normalizedTextFieldTags) {
        throw createNarrativeTagsUserError('GCS_NARRATIVE_TAGS_INVALID_TAGS', 'extensions.gcs-narrative-tags.textFieldTags')
      }

      await setPersistedTextFieldTags(
        db as never,
        NARRATIVE_TAGS_EXTENSION_KEY,
        'fundingcaseagreement',
        payload.agreementId,
        normalizedTextFieldTags
      )
    }
  })

  nitroApp.hooks.hook('applicantrecipient:profile:updated', async payload => {
    const textFieldTags = resolveTextFieldTags(payload.rawBody)
    if (!textFieldTags) {
      return
    }

    const sources = await resolveProponentNarrativeTagSources(
      getGcsExtensionHookDatabase(payload) as never,
      NARRATIVE_TAGS_EXTENSION_KEY,
      payload.agencyId,
      payload.applicantRecipientId
    )

    if (sources.length === 0) {
      return
    }

    const normalizedTextFieldTags = validateProponentTextFieldTags(sources, textFieldTags)
    if (!normalizedTextFieldTags) {
      throw createNarrativeTagsUserError('GCS_NARRATIVE_TAGS_INVALID_TAGS', 'extensions.gcs-narrative-tags.textFieldTags')
    }

    await setPersistedTextFieldTags(
      getGcsExtensionHookDatabase(payload) as never,
      NARRATIVE_TAGS_EXTENSION_KEY,
      NARRATIVE_TAGS_PROPONENT_OWNER_TYPE,
      payload.applicantRecipientId,
      normalizedTextFieldTags
    )
  })
})
