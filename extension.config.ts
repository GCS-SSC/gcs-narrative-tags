import { defineGcsExtension } from '@gcs-ssc/extensions'

export default defineGcsExtension({
  key: 'gcs-narrative-tags',
  sdkVersion: '^0.2.0',
  requiredHostCapabilities: [
    'stream-config-modal',
    'textarea-slots',
    'server-handlers',
    'server-handler-rbac',
    'runtime-resolution',
    'public-assets',
    'extension-ui',
    'extension-api-client',
    'extension-lifecycle-hooks'
  ],
  name: {
    en: 'Narrative Tags',
    fr: 'Étiquettes narratives'
  },
  description: {
    en: 'Suggests predefined tags from configured narrative fields.',
    fr: 'Suggère des étiquettes prédéfinies à partir des champs narratifs configurés.'
  },
  admin: {
    streamConfig: {
      path: './components/NarrativeTagsConfig.vue'
    }
  },
  client: {
    slots: [
      {
        slot: 'agreement.descriptions.after',
        path: './components/NarrativeTagsSlot.vue'
      },
      {
        slot: 'proponent.descriptions.after',
        path: './components/NarrativeTagsSlot.vue'
      }
    ]
  },
  assets: [
    {
      path: './client',
      baseURL: '/extensions/gcs-narrative-tags/client'
    },
    {
      package: '@browser-tag-extractor/core',
      packagePath: 'models',
      baseURL: '/extensions/gcs-narrative-tags/models'
    }
  ],
  nitroPlugin: './server/nitro-plugin.ts',
  runtime: {
    path: './server/runtime.ts'
  },
  serverHandlers: [
    {
      route: '/streams/[streamId]/agreements/[agreementId]/tags',
      method: 'get',
      rbac: {
        subject: 'agreement',
        action: 'read',
        entity: {
          target: 'agreement',
          param: 'agreementId'
        }
      },
      path: './server/api/extensions/gcs-narrative-tags/streams/[streamId]/agreements/[agreementId]/tags.get.ts'
    },
    {
      route: '/streams/[streamId]/agreements/[agreementId]/tags',
      method: 'patch',
      rbac: {
        subject: 'agreement',
        action: 'update',
        entity: {
          target: 'agreement',
          param: 'agreementId'
        }
      },
      path: './server/api/extensions/gcs-narrative-tags/streams/[streamId]/agreements/[agreementId]/tags.patch.ts'
    },
    {
      route: '/agencies/[agencyId]/applicant-recipients/[applicantRecipientId]/tags',
      method: 'get',
      rbac: {
        subject: 'applicant_recipient',
        action: 'read',
        entity: {
          target: 'proponent',
          param: 'applicantRecipientId'
        }
      },
      path: './server/api/extensions/gcs-narrative-tags/agencies/[agencyId]/applicant-recipients/[applicantRecipientId]/tags.get.ts'
    }
  ]
})
