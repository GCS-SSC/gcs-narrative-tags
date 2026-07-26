import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import {
  createExtensionRouteErrorResponse,
  resolveNarrativeTagsRouteContext,
  setPersistedNarrativeTags,
  validateRequestedTags
} from '../../../../../../../narrative-tags-route.ts'

export default defineGcsExtensionRouteHandler(async context => {
  const { readBody } = context
  const routeContext = await resolveNarrativeTagsRouteContext(context, 'update')

  const body = await readBody<{ tags?: unknown }>()
  const requestedTags = validateRequestedTags(routeContext.config, body.tags)
  if (!requestedTags) {
    return createExtensionRouteErrorResponse(400, 'INVALID_TAGS', 'Tags must match the configured narrative tag rules.')
  }

  const row = await setPersistedNarrativeTags(
    routeContext.db,
    routeContext.extensionKey,
    routeContext.agreementId,
    requestedTags
  )

  return {
    tags: requestedTags,
    row
  }
})
