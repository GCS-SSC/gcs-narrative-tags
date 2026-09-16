import extension from '../../extension.config'
// Integration adapter from the host tooling checkout; production code uses only the SDK.
const { verifyExtensionAuditContract } = await import(new URL(
  '../../../../tooling/gcs-ssc/tests/fixtures/extension-audit-contract.ts', import.meta.url
).href)

verifyExtensionAuditContract(extension, [
  {
    'table': 'extensions.kv_entry',
    'row': {
      'id': '1',
      'owner_type': 'fundingcaseagreement',
      'owner_id': '301',
      'extension_key': 'gcs-narrative-tags',
      'config_key': 'agreement-description-tags'
    },
    'agencies': [
      '11'
    ]
  },
  {
    'table': 'extensions.kv_entry',
    'row': {
      'id': '2',
      'owner_type': 'applicantrecipient',
      'owner_id': '601',
      'extension_key': 'gcs-narrative-tags',
      'config_key': 'text-field-tags'
    },
    'agencies': [
      '11',
      '22'
    ]
  },
  {
    'table': 'extensions.agency_enablement',
    'row': {
      'id': '90',
      'agency_id': '11',
      'extension_key': 'gcs-narrative-tags'
    },
    'agencies': [
      '11'
    ]
  },
  {
    'table': 'extensions.stream_configuration',
    'row': {
      'id': '91',
      'stream_id': '201',
      'extension_key': 'gcs-narrative-tags'
    },
    'agencies': [
      '11'
    ]
  }
])
