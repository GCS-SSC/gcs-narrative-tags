import { NarrativeTagsErrorMessages } from '../i18n/errors.ts'
import { translateGcsExtensionMessage } from '@gcs-ssc/extensions'
import {
  createGcsExtensionUserError,
  type GcsExtensionLocalizedMessage,
  type GcsExtensionUserErrorDetail,
  type GcsExtensionUserErrorOptions
} from '@gcs-ssc/extensions/server'

type NarrativeTagsErrorCode =
  | 'GCS_NARRATIVE_TAGS_MISSING_ROUTE_IDS'
  | 'GCS_NARRATIVE_TAGS_EXTENSION_NOT_FOUND'
  | 'GCS_NARRATIVE_TAGS_AGREEMENT_NOT_FOUND'
  | 'GCS_NARRATIVE_TAGS_STREAM_DISABLED'
  | 'GCS_NARRATIVE_TAGS_UNAUTHORIZED'
  | 'GCS_NARRATIVE_TAGS_FORBIDDEN'
  | 'GCS_NARRATIVE_TAGS_INVALID_TAGS'

const statusCodes: Record<NarrativeTagsErrorCode, number> = {
  GCS_NARRATIVE_TAGS_MISSING_ROUTE_IDS: 400,
  GCS_NARRATIVE_TAGS_EXTENSION_NOT_FOUND: 404,
  GCS_NARRATIVE_TAGS_AGREEMENT_NOT_FOUND: 404,
  GCS_NARRATIVE_TAGS_STREAM_DISABLED: 403,
  GCS_NARRATIVE_TAGS_UNAUTHORIZED: 401,
  GCS_NARRATIVE_TAGS_FORBIDDEN: 403,
  GCS_NARRATIVE_TAGS_INVALID_TAGS: 400
}

const defaultLocalizedMessage = (message: GcsExtensionLocalizedMessage): string =>
  typeof message === 'string' ? message : message.en

const createLocalizedUserError = (options: GcsExtensionUserErrorOptions) => {
  const error = createGcsExtensionUserError({
    ...options,
    message: defaultLocalizedMessage(options.message),
    details: options.details as GcsExtensionUserErrorDetail[] | undefined
  })

  return Object.assign(error, {
    localizedMessage: options.message,
    details: options.details
  })
}

/**
 * Returns the bilingual message registered for a narrative-tags error code.
 */
const getNarrativeTagsErrorMessage = (
  code: NarrativeTagsErrorCode
) => ({
  en: translateGcsExtensionMessage(NarrativeTagsErrorMessages, 'en', code),
  fr: translateGcsExtensionMessage(NarrativeTagsErrorMessages, 'fr', code)
})

/**
 * Creates a localized user error with the code's HTTP status and optional field-level detail.
 */
export const createNarrativeTagsUserError = (
  code: NarrativeTagsErrorCode,
  path?: string
) => createLocalizedUserError({
  code,
  statusCode: statusCodes[code],
  message: getNarrativeTagsErrorMessage(code),
  details: path
    ? [{
        path,
        code,
        message: getNarrativeTagsErrorMessage(code)
      }]
    : undefined
})
