// Tests for Elo utilities
// Run with: deno test --allow-env supabase/functions/_shared/utils.test.ts

import { assertEquals, assertAlmostEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  eloToDisplayScore,
  dynamicKFactor,
  expectedScore,
  getSeedRating,
  ELO_SEED,
  ELO_K_BASE,
  ELO_K_MIN,
  MARK_THRESHOLD,
} from './utils.ts'

// =============================================================================
// eloToDisplayScore Tests
// =============================================================================

Deno.test('eloToDisplayScore: rating 1500 returns 5.0 (midpoint)', () => {
  const score = eloToDisplayScore(1500)
  assertEquals(score, 5.0)
})

Deno.test('eloToDisplayScore: rating 1700 returns ~7.3 (higher)', () => {
  const score = eloToDisplayScore(1700)
  // sigmoid((1700-1500)/200) = sigmoid(1) ≈ 0.731
  // 10 * 0.731 ≈ 7.3
  assertEquals(score >= 7.0 && score <= 7.5, true, `Expected ~7.3, got ${score}`)
})

Deno.test('eloToDisplayScore: rating 1300 returns ~2.7 (lower)', () => {
  const score = eloToDisplayScore(1300)
  // sigmoid((1300-1500)/200) = sigmoid(-1) ≈ 0.269
  // 10 * 0.269 ≈ 2.7
  assertEquals(score >= 2.5 && score <= 3.0, true, `Expected ~2.7, got ${score}`)
})

Deno.test('eloToDisplayScore: rating 1000 returns ~0.8 (very low)', () => {
  const score = eloToDisplayScore(1000)
  // sigmoid((1000-1500)/200) = sigmoid(-2.5) ≈ 0.076
  // 10 * 0.076 ≈ 0.8
  assertEquals(score >= 0.5 && score <= 1.0, true, `Expected ~0.8, got ${score}`)
})

Deno.test('eloToDisplayScore: rating 2000 returns ~9.2 (very high)', () => {
  const score = eloToDisplayScore(2000)
  // sigmoid((2000-1500)/200) = sigmoid(2.5) ≈ 0.924
  // 10 * 0.924 ≈ 9.2
  assertEquals(score >= 9.0 && score <= 9.5, true, `Expected ~9.2, got ${score}`)
})

Deno.test('eloToDisplayScore: returns value rounded to 1 decimal', () => {
  const score = eloToDisplayScore(1550)
  const decimalPlaces = (score.toString().split('.')[1] || '').length
  assertEquals(decimalPlaces <= 1, true)
})

Deno.test('eloToDisplayScore: score is bounded 0-10', () => {
  // Even extreme ratings should stay in 0-10 range
  const veryLow = eloToDisplayScore(500)
  const veryHigh = eloToDisplayScore(2500)
  
  assertEquals(veryLow >= 0, true)
  assertEquals(veryLow <= 10, true)
  assertEquals(veryHigh >= 0, true)
  assertEquals(veryHigh <= 10, true)
})

// =============================================================================
// dynamicKFactor Tests
// =============================================================================

Deno.test('dynamicKFactor: 0 games returns K_BASE (24)', () => {
  const k = dynamicKFactor(0)
  assertEquals(k, ELO_K_BASE)
})

Deno.test('dynamicKFactor: 50 games returns 24-5=19', () => {
  const k = dynamicKFactor(50)
  assertEquals(k, 19)
})

Deno.test('dynamicKFactor: 100 games returns 24-10=14', () => {
  const k = dynamicKFactor(100)
  assertEquals(k, 14)
})

Deno.test('dynamicKFactor: 120 games returns K_MIN (12), not 12', () => {
  const k = dynamicKFactor(120)
  // 24 - 12 = 12, exactly at minimum
  assertEquals(k, ELO_K_MIN)
})

Deno.test('dynamicKFactor: 200 games returns K_MIN (12), floors at minimum', () => {
  const k = dynamicKFactor(200)
  // 24 - 20 = 4, but should floor at K_MIN (12)
  assertEquals(k, ELO_K_MIN)
})

// =============================================================================
// expectedScore Tests (Elo formula)
// =============================================================================

Deno.test('expectedScore: equal ratings return 0.5', () => {
  const expected = expectedScore(1500, 1500)
  assertEquals(expected, 0.5)
})

Deno.test('expectedScore: 400 point difference returns ~0.91 for favorite', () => {
  const expected = expectedScore(1900, 1500)
  // 1 / (1 + 10^((1500-1900)/400)) = 1 / (1 + 10^-1) ≈ 0.909
  assertEquals(expected >= 0.90 && expected <= 0.92, true, `Expected ~0.91, got ${expected}`)
})

Deno.test('expectedScore: 400 point difference returns ~0.09 for underdog', () => {
  const expected = expectedScore(1500, 1900)
  // 1 / (1 + 10^((1900-1500)/400)) = 1 / (1 + 10^1) ≈ 0.091
  assertEquals(expected >= 0.08 && expected <= 0.10, true, `Expected ~0.09, got ${expected}`)
})

Deno.test('expectedScore: expected scores for A and B sum to 1', () => {
  const expA = expectedScore(1500, 1650)
  const expB = expectedScore(1650, 1500)
  const sum = expA + expB
  // Should be approximately 1 (allowing for floating point errors)
  assertEquals(Math.abs(sum - 1) < 0.0001, true, `Expected sum=1, got ${sum}`)
})

// =============================================================================
// getSeedRating Tests
// =============================================================================

Deno.test('getSeedRating: LIKED returns 1550', () => {
  assertEquals(getSeedRating('LIKED'), ELO_SEED.LIKED)
  assertEquals(getSeedRating('LIKED'), 1550)
})

Deno.test('getSeedRating: FINE returns 1500', () => {
  assertEquals(getSeedRating('FINE'), ELO_SEED.FINE)
  assertEquals(getSeedRating('FINE'), 1500)
})

Deno.test('getSeedRating: DISLIKED returns 1450', () => {
  assertEquals(getSeedRating('DISLIKED'), ELO_SEED.DISLIKED)
  assertEquals(getSeedRating('DISLIKED'), 1450)
})

Deno.test('getSeedRating: null returns default (FINE = 1500)', () => {
  assertEquals(getSeedRating(null), 1500)
})

Deno.test('getSeedRating: unknown value returns default (FINE = 1500)', () => {
  assertEquals(getSeedRating('UNKNOWN'), 1500)
})

// =============================================================================
// Constants Tests
// =============================================================================

Deno.test('MARK_THRESHOLD is 15', () => {
  assertEquals(MARK_THRESHOLD, 15)
})

Deno.test('ELO_K_BASE is 24', () => {
  assertEquals(ELO_K_BASE, 24)
})

Deno.test('ELO_K_MIN is 12', () => {
  assertEquals(ELO_K_MIN, 12)
})

Deno.test('ELO_SEED values are correctly spaced', () => {
  assertEquals(ELO_SEED.LIKED - ELO_SEED.FINE, 50)
  assertEquals(ELO_SEED.FINE - ELO_SEED.DISLIKED, 50)
})
