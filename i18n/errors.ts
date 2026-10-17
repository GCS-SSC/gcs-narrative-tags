import { defineGcsExtensionMessages } from '@gcs-ssc/extensions'

export const NarrativeTagsErrorMessages = defineGcsExtensionMessages({
  en: {
    GCS_NARRATIVE_TAGS_MISSING_ROUTE_IDS: 'The narrative tags route is missing required identifiers.',
    GCS_NARRATIVE_TAGS_EXTENSION_NOT_FOUND: 'The narrative tags extension route could not be found.',
    GCS_NARRATIVE_TAGS_AGREEMENT_NOT_FOUND: 'The agreement for narrative tags could not be found.',
    GCS_NARRATIVE_TAGS_STREAM_DISABLED: 'Narrative tags are disabled for this stream.',
    GCS_NARRATIVE_TAGS_UNAUTHORIZED: 'Sign in before using narrative tags.',
    GCS_NARRATIVE_TAGS_FORBIDDEN: 'You do not have permission to use narrative tags here.',
    GCS_NARRATIVE_TAGS_INVALID_TAGS: 'Select tags that match the configured narrative tag rules.'
  },
  fr: {
    GCS_NARRATIVE_TAGS_MISSING_ROUTE_IDS: 'La route des étiquettes narratives ne contient pas les identifiants requis.',
    GCS_NARRATIVE_TAGS_EXTENSION_NOT_FOUND: 'La route de l’extension des étiquettes narratives est introuvable.',
    GCS_NARRATIVE_TAGS_AGREEMENT_NOT_FOUND: 'L’entente pour les étiquettes narratives est introuvable.',
    GCS_NARRATIVE_TAGS_STREAM_DISABLED: 'Les étiquettes narratives sont désactivées pour ce volet.',
    GCS_NARRATIVE_TAGS_UNAUTHORIZED: 'Connectez-vous avant d’utiliser les étiquettes narratives.',
    GCS_NARRATIVE_TAGS_FORBIDDEN: 'Vous n’avez pas l’autorisation d’utiliser les étiquettes narratives ici.',
    GCS_NARRATIVE_TAGS_INVALID_TAGS: 'Sélectionnez des étiquettes qui respectent les règles configurées.'
  }
})
