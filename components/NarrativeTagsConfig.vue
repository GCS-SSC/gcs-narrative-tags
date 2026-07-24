<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { GCS_TEXTAREA_TARGETS } from '@gcs-ssc/extensions'
import type { GcsTextareaKnownTargetKey, JsonValue } from '@gcs-ssc/extensions'
import {
  ExtensionButton,
  ExtensionFormField,
  ExtensionInput,
  ExtensionInputTags,
  ExtensionSection,
  ExtensionSelect,
  ExtensionSwitch,
  ExtensionTextarea,
  ExtensionTooltip,
  useExtensionI18n
} from '@gcs-ssc/extensions/ui'
import {
  AGREEMENT_TAG_COLORS,
  getNarrativeTagsTargetConfig,
  normalizeNarrativeTagKey,
  normalizeNarrativeTagsConfig,
  toNarrativeTagsJson
} from './narrative-tags'
import type { NarrativeTagDefinition, NarrativeTagsConfig, NarrativeTagsTargetConfig, NarrativeTagLocale } from './narrative-tags'

const model = defineModel<Record<string, JsonValue>>({
  default: () => ({})
})

const { locale } = useExtensionI18n()

const state: Ref<NarrativeTagsConfig> = ref(normalizeNarrativeTagsConfig(model.value))
const activeTarget: Ref<GcsTextareaKnownTargetKey> = ref('agreement.description')

const labels = {
  title: { en: 'Narrative tag setup', fr: 'Configuration des étiquettes narratives' },
  description: {
    en: 'Configure the text fields and predefined tag vocabulary used for tag suggestions.',
    fr: 'Configurez les champs texte et le vocabulaire prédéfini utilisés pour les suggestions d’étiquettes.'
  },
  targetFields: { en: 'Target field', fr: 'Champ ciblé' },
  targetDescription: {
    en: 'Choose which narrative field this configuration applies to before editing the suggestion settings.',
    fr: 'Choisissez le champ narratif auquel cette configuration s’applique avant de modifier les paramètres de suggestion.'
  },
  target: { en: 'Target', fr: 'Cible' },
  enabled: { en: 'Enable tag suggestions for this target', fr: 'Activer les suggestions d’étiquettes pour cette cible' },
  allowCustomTags: { en: 'Allow custom tags', fr: 'Autoriser les étiquettes personnalisées' },
  allowDynamicTagSuggestions: { en: 'Suggest dynamic tags', fr: 'Suggérer des étiquettes dynamiques' },
  minScore: { en: 'Minimum score', fr: 'Score minimal' },
  maxSuggestions: { en: 'Maximum suggestions', fr: 'Nombre maximal de suggestions' },
  minDynamicScore: { en: 'Minimum dynamic score', fr: 'Score dynamique minimal' },
  maxDynamicTags: { en: 'Maximum dynamic tags', fr: 'Nombre maximal d’étiquettes dynamiques' },
  dynamicNgramMin: { en: 'Minimum phrase words', fr: 'Mots minimaux par expression' },
  dynamicNgramMax: { en: 'Maximum phrase words', fr: 'Mots maximaux par expression' },
  semanticWeight: { en: 'Semantic weight', fr: 'Pondération sémantique' },
  lexicalWeight: { en: 'Lexical weight', fr: 'Pondération lexicale' },
  exactAliasBoost: { en: 'Exact alias boost', fr: 'Bonus d’alias exact' },
  negationPenalty: { en: 'Negation penalty', fr: 'Pénalité de négation' },
  negationWindow: { en: 'Negation window', fr: 'Fenêtre de négation' },
  useEmbeddingCache: { en: 'Cache embeddings', fr: 'Mettre les plongements en cache' },
  useBrowserCache: { en: 'Cache model files', fr: 'Mettre les fichiers du modèle en cache' },
  scoring: { en: 'Scoring', fr: 'Notation' },
  tags: { en: 'Tags', fr: 'Étiquettes' },
  addTag: { en: 'Add tag', fr: 'Ajouter une étiquette' },
  removeTag: { en: 'Remove tag', fr: 'Supprimer l’étiquette' },
  key: { en: 'Key', fr: 'Clé' },
  labelEn: { en: 'English label', fr: 'Libellé anglais' },
  labelFr: { en: 'French label', fr: 'Libellé français' },
  descriptionEn: { en: 'English description', fr: 'Description anglaise' },
  descriptionFr: { en: 'French description', fr: 'Description française' },
  aliases: { en: 'Aliases', fr: 'Alias' },
  color: { en: 'Color', fr: 'Couleur' }
} as const

const text = (key: keyof typeof labels) => {
  const item = labels[key]
  return locale.value === 'fr' ? item.fr : item.en
}

const colorOptions = computed(() => AGREEMENT_TAG_COLORS.map(color => ({
  label: color,
  value: color
})))

const targetOptions = computed(() => GCS_TEXTAREA_TARGETS.map(target => ({
  key: target.key,
  value: target.key,
  label: locale.value === 'fr' ? target.label.fr : target.label.en,
  descriptionText: locale.value === 'fr' ? target.description.fr : target.description.en
})))

const currentTarget = computed<NarrativeTagsTargetConfig>(() => getNarrativeTagsTargetConfig(state.value, activeTarget.value))

const tagKeyAtIndex = (index: number, key: string): string => `${index}-${key}`

const nextAvailableKey = () => {
  const existingKeys = new Set(state.value.tags.map(tag => tag.key))
  let nextIndex = state.value.tags.length + 1
  let key = `tag-${nextIndex}`

  while (existingKeys.has(key)) {
    nextIndex += 1
    key = `tag-${nextIndex}`
  }

  return key
}

watch(() => model.value, value => {
  const nextState = normalizeNarrativeTagsConfig(value)
  if (JSON.stringify(toNarrativeTagsJson(nextState)) !== JSON.stringify(toNarrativeTagsJson(state.value))) {
    state.value = nextState
  }
}, { deep: true })

watch(state, value => {
  const nextModel = toNarrativeTagsJson(value)
  if (JSON.stringify(nextModel) !== JSON.stringify(model.value)) {
    model.value = nextModel
  }
}, { deep: true })

const createTag = (): NarrativeTagDefinition => {
  const nextIndex = state.value.tags.length + 1
  return {
    key: nextAvailableKey(),
    label: {
      en: `Tag ${nextIndex}`,
      fr: `Étiquette ${nextIndex}`
    },
    description: {
      en: '',
      fr: ''
    },
    aliases: [],
    color: 'neutral'
  }
}

const addTag = () => {
  state.value.tags = [...state.value.tags, createTag()]
}

const removeTag = (index: number) => {
  state.value.tags = state.value.tags.filter((_, itemIndex) => itemIndex !== index)
}

const updateLocalizedField = (
  tag: NarrativeTagDefinition,
  field: 'label' | 'description',
  tagLocale: NarrativeTagLocale,
  value: string | number
) => {
  tag[field][tagLocale] = String(value)
}

const updateTagKey = (tag: NarrativeTagDefinition, value: string | number) => {
  tag.key = normalizeNarrativeTagKey(String(value))
}

const updateAllowCustomTags = (value: boolean | string) => {
  currentTarget.value.allowCustomTags = value === true
}

const updateAllowDynamicTagSuggestions = (value: boolean | string) => {
  currentTarget.value.allowDynamicTagSuggestions = value === true
}

const updateUseEmbeddingCache = (value: boolean | string) => {
  currentTarget.value.useEmbeddingCache = value === true
}

const updateUseBrowserCache = (value: boolean | string) => {
  currentTarget.value.useBrowserCache = value === true
}

const updateTargetEnabled = (targetKey: GcsTextareaKnownTargetKey, value: boolean | string) => {
  state.value.targets[targetKey].enabled = value === true
}
</script>

<template>
  <div class="space-y-8">
    <div>
      <h3 class="text-base font-semibold text-zinc-900 dark:text-white">
        {{ text('title') }}
      </h3>
      <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {{ text('description') }}
      </p>
    </div>

    <ExtensionSection :title="text('targetFields')" badge="01" :grid-cols="2">
      <div class="space-y-2 md:col-span-2">
        <p class="text-sm text-zinc-500 dark:text-zinc-400">
          {{ text('targetDescription') }}
        </p>
      </div>

      <ExtensionFormField :label="text('target')">
        <ExtensionSelect
          v-model="activeTarget"
          :items="targetOptions"
          value-key="value"
          label-key="label" />
      </ExtensionFormField>

      <ExtensionFormField
        :label="text('enabled')"
        :description="targetOptions.find(target => target.key === activeTarget)?.descriptionText">
        <div class="flex min-h-10 items-center">
          <ExtensionSwitch
            :model-value="currentTarget.enabled"
            @update:model-value="(value: boolean | string) => updateTargetEnabled(activeTarget, value)" />
        </div>
      </ExtensionFormField>

      <ExtensionFormField :label="text('allowCustomTags')">
        <div class="flex min-h-10 items-center">
          <ExtensionSwitch
            :model-value="currentTarget.allowCustomTags"
            @update:model-value="updateAllowCustomTags" />
        </div>
      </ExtensionFormField>

      <ExtensionFormField :label="text('allowDynamicTagSuggestions')">
        <div class="flex min-h-10 items-center">
          <ExtensionSwitch
            :model-value="currentTarget.allowDynamicTagSuggestions"
            @update:model-value="updateAllowDynamicTagSuggestions" />
        </div>
      </ExtensionFormField>

      <ExtensionFormField :label="text('minScore')">
        <ExtensionInput v-model.number="currentTarget.minScore" type="number" min="0" max="1" step="0.01" />
      </ExtensionFormField>

      <ExtensionFormField :label="text('maxSuggestions')">
        <ExtensionInput v-model.number="currentTarget.maxSuggestions" type="number" min="1" max="12" step="1" />
      </ExtensionFormField>
    </ExtensionSection>

    <ExtensionSection :title="text('scoring')" badge="02" :grid-cols="3">
      <ExtensionFormField :label="text('minDynamicScore')">
        <ExtensionInput v-model.number="currentTarget.minDynamicScore" type="number" min="0" max="1" step="0.01" />
      </ExtensionFormField>

      <ExtensionFormField :label="text('maxDynamicTags')">
        <ExtensionInput v-model.number="currentTarget.maxDynamicTags" type="number" min="1" max="12" step="1" />
      </ExtensionFormField>

      <ExtensionFormField :label="text('dynamicNgramMin')">
        <ExtensionInput v-model.number="currentTarget.dynamicNgramMin" type="number" min="1" max="5" step="1" />
      </ExtensionFormField>

      <ExtensionFormField :label="text('dynamicNgramMax')">
        <ExtensionInput v-model.number="currentTarget.dynamicNgramMax" type="number" min="1" max="5" step="1" />
      </ExtensionFormField>

      <ExtensionFormField :label="text('semanticWeight')">
        <ExtensionInput v-model.number="currentTarget.semanticWeight" type="number" min="0" max="1" step="0.01" />
      </ExtensionFormField>

      <ExtensionFormField :label="text('lexicalWeight')">
        <ExtensionInput v-model.number="currentTarget.lexicalWeight" type="number" min="0" max="1" step="0.01" />
      </ExtensionFormField>

      <ExtensionFormField :label="text('exactAliasBoost')">
        <ExtensionInput v-model.number="currentTarget.exactAliasBoost" type="number" min="0" max="1" step="0.01" />
      </ExtensionFormField>

      <ExtensionFormField :label="text('negationPenalty')">
        <ExtensionInput v-model.number="currentTarget.negationPenalty" type="number" min="0" max="1" step="0.01" />
      </ExtensionFormField>

      <ExtensionFormField :label="text('negationWindow')">
        <ExtensionInput v-model.number="currentTarget.negationWindow" type="number" min="0" max="20" step="1" />
      </ExtensionFormField>

      <ExtensionFormField :label="text('useEmbeddingCache')">
        <div class="flex min-h-10 items-center">
          <ExtensionSwitch
            :model-value="currentTarget.useEmbeddingCache"
            @update:model-value="updateUseEmbeddingCache" />
        </div>
      </ExtensionFormField>

      <ExtensionFormField :label="text('useBrowserCache')">
        <div class="flex min-h-10 items-center">
          <ExtensionSwitch
            :model-value="currentTarget.useBrowserCache"
            @update:model-value="updateUseBrowserCache" />
        </div>
      </ExtensionFormField>
    </ExtensionSection>

    <ExtensionSection :title="text('tags')" badge="03" :grid-cols="1">
      <div class="space-y-4">
        <div
          v-for="(tag, index) in state.tags"
          :key="tagKeyAtIndex(index, tag.key)"
          class="border-default space-y-4 border-b pb-4 last:border-b-0 last:pb-0">
          <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
            <ExtensionFormField :label="text('key')">
              <ExtensionInput
                :model-value="tag.key"
                @update:model-value="(value: string | number) => updateTagKey(tag, value)" />
            </ExtensionFormField>

            <ExtensionFormField :label="text('labelEn')">
              <ExtensionInput
                :model-value="tag.label.en"
                @update:model-value="(value: string | number) => updateLocalizedField(tag, 'label', 'en', value)" />
            </ExtensionFormField>

            <ExtensionFormField :label="text('labelFr')">
              <ExtensionInput
                :model-value="tag.label.fr"
                @update:model-value="(value: string | number) => updateLocalizedField(tag, 'label', 'fr', value)" />
            </ExtensionFormField>

            <ExtensionFormField :label="text('descriptionEn')">
              <ExtensionTextarea
                :model-value="tag.description.en"
                :rows="2"
                @update:model-value="(value: string | number) => updateLocalizedField(tag, 'description', 'en', value)" />
            </ExtensionFormField>

            <ExtensionFormField :label="text('descriptionFr')">
              <ExtensionTextarea
                :model-value="tag.description.fr"
                :rows="2"
                @update:model-value="(value: string | number) => updateLocalizedField(tag, 'description', 'fr', value)" />
            </ExtensionFormField>

            <ExtensionFormField :label="text('color')">
              <ExtensionSelect
                v-model="tag.color"
                :items="colorOptions"
                value-key="value"
                label-key="label" />
            </ExtensionFormField>
          </div>

          <div class="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <ExtensionFormField :label="text('aliases')">
              <ExtensionInputTags v-model="tag.aliases" :add-on-blur="true" />
            </ExtensionFormField>

            <ExtensionTooltip :text="text('removeTag')">
              <ExtensionButton
                color="error"
                variant="ghost"
                icon="i-lucide-trash-2"
                class="cursor-default"
                :aria-label="text('removeTag')"
                @click="removeTag(index)" />
            </ExtensionTooltip>
          </div>
        </div>

        <ExtensionButton
          color="neutral"
          variant="outline"
          icon="i-lucide-plus"
          class="cursor-default"
          :label="text('addTag')"
          @click="addTag" />
      </div>
    </ExtensionSection>
  </div>
</template>
