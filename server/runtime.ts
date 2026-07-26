import type {
  GcsExtensionRuntimeContext,
  GcsExtensionRuntimeHostContext,
  GcsExtensionRuntimeResolution
} from '@gcs-ssc/extensions'
import {
  NARRATIVE_TAGS_EXTENSION_KEY,
  requireNarrativeTagsRouteDatabase,
  resolveProponentNarrativeTagSources,
} from './narrative-tags-route.ts'

/**
 * Enables the proponent description slot only when the entity has at least one enabled tag source.
 */
export default async (
  host: GcsExtensionRuntimeHostContext,
  context: GcsExtensionRuntimeContext
): Promise<GcsExtensionRuntimeResolution | null> => {
  if (
    context.slot !== 'proponent.descriptions.after'
    || !context.agencyId
    || !context.applicantRecipientId
  ) {
    return null
  }

  const sources = await resolveProponentNarrativeTagSources(
    requireNarrativeTagsRouteDatabase(host.db),
    NARRATIVE_TAGS_EXTENSION_KEY,
    context.agencyId,
    context.applicantRecipientId
  )

  return sources.length > 0
    ? {
        enabled: true,
        config: {}
      }
    : null
}
