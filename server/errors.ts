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

const errorMessages: Record<NarrativeTagsErrorCode, GcsExtensionLocalizedMessage> = {
  GCS_NARRATIVE_TAGS_MISSING_ROUTE_IDS: {
    en: 'The narrative tags route is missing required identifiers.',
    fr: 'La route des etiquettes narratives ne contient pas les identifiants requis.'
  },
  GCS_NARRATIVE_TAGS_EXTENSION_NOT_FOUND: {
    en: 'The narrative tags extension route could not be found.',
    fr: 'La route de l extension des etiquettes narratives est introuvable.'
  },
  GCS_NARRATIVE_TAGS_AGREEMENT_NOT_FOUND: {
    en: 'The agreement for narrative tags could not be found.',
    fr: 'L entente pour les etiquettes narratives est introuvable.'
  },
  GCS_NARRATIVE_TAGS_STREAM_DISABLED: {
    en: 'Narrative tags are disabled for this stream.',
    fr: 'Les etiquettes narratives sont desactivees pour ce volet.'
  },
  GCS_NARRATIVE_TAGS_UNAUTHORIZED: {
    en: 'Sign in before using narrative tags.',
    fr: 'Connectez-vous avant d utiliser les etiquettes narratives.'
  },
  GCS_NARRATIVE_TAGS_FORBIDDEN: {
    en: 'You do not have permission to use narrative tags here.',
    fr: 'Vous n avez pas l autorisation d utiliser les etiquettes narratives ici.'
  },
  GCS_NARRATIVE_TAGS_INVALID_TAGS: {
    en: 'Select tags that match the configured narrative tag rules.',
    fr: 'Selectionnez des etiquettes qui respectent les regles configurees.'
  }
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
export const getNarrativeTagsErrorMessage = (
  code: NarrativeTagsErrorCode
) => errorMessages[code]

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
