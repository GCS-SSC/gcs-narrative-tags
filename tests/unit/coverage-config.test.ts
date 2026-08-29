import { describe, expect, it } from 'vitest'

import config, {
  NARRATIVE_TAGS_COVERAGE_INCLUDE,
  NARRATIVE_TAGS_COVERAGE_THRESHOLDS
} from '../../vitest.config'

type CoverageConfig = {
  include?: string[]
  thresholds?: Partial<Record<keyof typeof NARRATIVE_TAGS_COVERAGE_THRESHOLDS, number>>
}
type CoverageProjectConfig = { test?: { coverage?: CoverageConfig } }

const assertCoverageContract = (coverage: CoverageConfig): void => {
  for (const source of NARRATIVE_TAGS_COVERAGE_INCLUDE) expect(coverage.include).toContain(source)
  expect(coverage.thresholds).toEqual(NARRATIVE_TAGS_COVERAGE_THRESHOLDS)
}

describe('Narrative Tags coverage configuration', () => {
  const coverage = (config as CoverageProjectConfig).test?.coverage as CoverageConfig

  it('enforces the owner source universe and all four thresholds', () => {
    assertCoverageContract(coverage)
  })

  it.each(NARRATIVE_TAGS_COVERAGE_INCLUDE)('fails closed when %s is removed', (source) => {
    expect(() => assertCoverageContract({
      ...coverage,
      include: coverage.include?.filter(entry => entry !== source)
    })).toThrow()
  })

  it('fails closed when any threshold is lowered', () => {
    expect(() => assertCoverageContract({
      ...coverage,
      thresholds: { ...coverage.thresholds, lines: 79 }
    })).toThrow()
  })
})
