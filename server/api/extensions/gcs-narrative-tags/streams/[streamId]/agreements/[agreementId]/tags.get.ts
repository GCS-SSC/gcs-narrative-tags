import { defineGcsExtensionRouteHandler } from '@gcs-ssc/extensions/server'
import {
  getPersistedNarrativeTags,
  getPersistedTextFieldTags,
  resolveNarrativeTagsRouteContext
} from '../../../../../../../narrative-tags-route'

export default defineGcsExtensionRouteHandler(async context => {
  const routeContext = await resolveNarrativeTagsRouteContext(context, 'read')

  const tags = await getPersistedNarrativeTags(
    routeContext.db,
    routeContext.extensionKey,
    routeContext.agreementId
  )
  const textFieldTags = await getPersistedTextFieldTags(
    routeContext.db,
    routeContext.extensionKey,
    'fundingcaseagreement',
    routeContext.agreementId
  )

  return {
    tags: tags.filter(tag => !tag.predefined || routeContext.config.tags.some(item => item.key === tag.key)),
    textFieldTags
  }
})
