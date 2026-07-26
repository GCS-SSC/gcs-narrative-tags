import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import {
  NARRATIVE_TAGS_EXTENSION_KEY,
  NARRATIVE_TAGS_PROPONENT_OWNER_TYPE,
  createExtensionRouteErrorResponse,
  getPersistedTextFieldTags,
  requireNarrativeTagsRouteDatabase,
  resolveProponentNarrativeTagSources,
} from '../../../../../../../narrative-tags-route.ts'

export default defineGcsExtensionRouteHandler(async ({ params, auth, db: rawDb }) => {
  const extensionKey = params.extensionKey
  const agencyId = params.agencyId
  const applicantRecipientId = params.applicantRecipientId

  if (
    extensionKey !== NARRATIVE_TAGS_EXTENSION_KEY
    || typeof agencyId !== 'string'
    || typeof applicantRecipientId !== 'string'
  ) {
    return createExtensionRouteErrorResponse(400, 'MISSING_ID', 'Missing extension route identifiers.')
  }

  const authContext = auth
  if (!authContext) {
    return createExtensionRouteErrorResponse(401, 'AUTH_UNAUTHORIZED', 'Unauthorized.')
  }

  const db = requireNarrativeTagsRouteDatabase(rawDb)
  const sources = await resolveProponentNarrativeTagSources(
    db,
    NARRATIVE_TAGS_EXTENSION_KEY,
    agencyId,
    applicantRecipientId
  )

  if (sources.length === 0) {
    return createExtensionRouteErrorResponse(404, 'APPLICANT_RECIPIENT_PROFILE_NOT_FOUND', 'Proponent not found.')
  }

  const canRead = authContext.userAbilities.authorize('applicant_recipient', 'read', {
    type: 'agency',
    agencyId
  })
  if (!canRead) {
    return createExtensionRouteErrorResponse(403, 'AUTH_FORBIDDEN', 'Forbidden.')
  }

  const textFieldTags = await getPersistedTextFieldTags(
    db,
    NARRATIVE_TAGS_EXTENSION_KEY,
    NARRATIVE_TAGS_PROPONENT_OWNER_TYPE,
    applicantRecipientId
  )

  return {
    tags: textFieldTags['proponent.description'] ?? textFieldTags['proponent.description:en'] ?? [],
    textFieldTags,
    sources
  }
})
