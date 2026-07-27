import {
  defineGcsExtensionRouteHandler,
  lockGcsExtensionLifecycleScope
} from '@gcs-ssc/extensions/server'
import {
  createExtensionRouteErrorResponse,
  resolveNarrativeTagsRouteContext,
  setPersistedNarrativeTags,
  validateRequestedTags
} from '../../../../../../../narrative-tags-route.ts'

export default defineGcsExtensionRouteHandler(async context => {
  const { readBody } = context
  const initialRouteContext = await resolveNarrativeTagsRouteContext(context, 'update')
  const writeAuthorization = context.writeAuthorization
  if (!writeAuthorization) {
    throw new Error('Narrative Tags writes require host-provided transaction authorization.')
  }
  const db = context.db as {
    transaction: () => {
      execute: <T>(callback: (trx: unknown) => Promise<T>) => Promise<T>
    }
  }

  const body = await readBody<{ tags?: unknown }>()
  return await db.transaction().execute(async rawTrx => {
    await writeAuthorization.lockAuthState(rawTrx)
    await lockGcsExtensionLifecycleScope(
      rawTrx as Parameters<typeof lockGcsExtensionLifecycleScope>[0],
      initialRouteContext.extensionKey,
      initialRouteContext.agencyId,
      initialRouteContext.streamId
    )
    const authorizeCurrentScope = writeAuthorization.authorizeCurrentScope === undefined
      ? writeAuthorization.authorizeCurrentEntity
      : writeAuthorization.authorizeCurrentScope
    await authorizeCurrentScope(rawTrx)

    const routeContext = await resolveNarrativeTagsRouteContext({
      ...context,
      db: rawTrx
    }, 'update')
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
})
