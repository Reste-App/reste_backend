// Tests for Elo utilities
// Run with: deno test --allow-env supabase/functions/_shared/utils.test.ts

import { assertEquals, assertAlmostEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  eloToDisplayScore,
  dynamicKFactor,
  expectedScore,
  getSeedRating,
  computePercentileDisplayScore,
  computeDisplayScoresForHotels,
  getDisplayScoreFromResults,
  DISPLAY_SCORE_BANDS,
  ELO_SEED,
  ELO_K_BASE,
  ELO_K_MIN,
  MARK_THRESHOLD,
  type SentimentTier,
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

// =============================================================================
// computePercentileDisplayScore Tests
// =============================================================================

Deno.test('computePercentileDisplayScore: n=1 returns midpoint of tier', () => {
  // Single hotel in tier should get midpoint
  const likedScore = computePercentileDisplayScore(0, 1, 'LIKED')
  const fineScore = computePercentileDisplayScore(0, 1, 'FINE')
  const dislikedScore = computePercentileDisplayScore(0, 1, 'DISLIKED')
  
  // LIKED: (6.7 + 10.0) / 2 = 8.35 -> 8.4
  assertEquals(likedScore, 8.4)
  // FINE: (3.4 + 6.7) / 2 = 5.05 -> 5.1 or 5.0
  assertEquals(fineScore >= 5.0 && fineScore <= 5.1, true, `Expected 5.0-5.1, got ${fineScore}`)
  // DISLIKED: (0.0 + 3.4) / 2 = 1.7
  assertEquals(dislikedScore, 1.7)
})

Deno.test('computePercentileDisplayScore: n=2 returns band endpoints', () => {
  // Two hotels: rank 0 gets min, rank 1 gets max
  const likedMin = computePercentileDisplayScore(0, 2, 'LIKED')
  const likedMax = computePercentileDisplayScore(1, 2, 'LIKED')
  
  assertEquals(likedMin, 6.7)  // min of LIKED band
  assertEquals(likedMax, 10.0) // max of LIKED band
  
  const fineMin = computePercentileDisplayScore(0, 2, 'FINE')
  const fineMax = computePercentileDisplayScore(1, 2, 'FINE')
  
  assertEquals(fineMin, 3.4)  // min of FINE band
  assertEquals(fineMax, 6.7)  // max of FINE band
  
  const dislikedMin = computePercentileDisplayScore(0, 2, 'DISLIKED')
  const dislikedMax = computePercentileDisplayScore(1, 2, 'DISLIKED')
  
  assertEquals(dislikedMin, 0.0)  // min of DISLIKED band
  assertEquals(dislikedMax, 3.4)  // max of DISLIKED band
})

Deno.test('computePercentileDisplayScore: n=3 distributes evenly', () => {
  // Three hotels in LIKED: rank 0,1,2 -> 0%, 50%, 100% of range
  const score0 = computePercentileDisplayScore(0, 3, 'LIKED') // 6.7
  const score1 = computePercentileDisplayScore(1, 3, 'LIKED') // 6.7 + 0.5*(10-6.7) = 8.35
  const score2 = computePercentileDisplayScore(2, 3, 'LIKED') // 10.0
  
  assertEquals(score0, 6.7)
  assertEquals(score1, 8.4) // rounded from 8.35
  assertEquals(score2, 10.0)
})

Deno.test('computePercentileDisplayScore: null sentiment defaults to FINE', () => {
  const score = computePercentileDisplayScore(0, 2, null)
  assertEquals(score, 3.4) // min of FINE band
})

Deno.test('computePercentileDisplayScore: scores are clamped to [0, 10]', () => {
  // All scores should be in valid range
  for (let i = 0; i < 10; i++) {
    const score = computePercentileDisplayScore(i, 10, 'LIKED')
    assertEquals(score >= 0 && score <= 10, true, `Score ${score} out of range`)
  }
})

Deno.test('computePercentileDisplayScore: scores are rounded to 1 decimal', () => {
  const score = computePercentileDisplayScore(1, 5, 'LIKED')
  const decimalPlaces = (score.toString().split('.')[1] || '').length
  assertEquals(decimalPlaces <= 1, true)
})

// =============================================================================
// computeDisplayScoresForHotels Tests
// =============================================================================

Deno.test('computeDisplayScoresForHotels: single hotel gets midpoint', () => {
  const hotels = [
    { place_id: 'hotel1', rating: 1500, sentiment: 'LIKED' as SentimentTier }
  ]
  
  const results = computeDisplayScoresForHotels(hotels)
  
  assertEquals(results.length, 1)
  assertEquals(results[0].place_id, 'hotel1')
  assertEquals(results[0].displayScore, 8.4) // midpoint of LIKED band
  assertEquals(results[0].rankInTier, 0)
  assertEquals(results[0].totalInTier, 1)
})

Deno.test('computeDisplayScoresForHotels: hotels sorted by rating within tier', () => {
  const hotels = [
    { place_id: 'hotel_low', rating: 1400, sentiment: 'LIKED' as SentimentTier },
    { place_id: 'hotel_high', rating: 1600, sentiment: 'LIKED' as SentimentTier },
    { place_id: 'hotel_mid', rating: 1500, sentiment: 'LIKED' as SentimentTier },
  ]
  
  const results = computeDisplayScoresForHotels(hotels)
  
  // Find each hotel's result
  const lowResult = results.find(r => r.place_id === 'hotel_low')!
  const midResult = results.find(r => r.place_id === 'hotel_mid')!
  const highResult = results.find(r => r.place_id === 'hotel_high')!
  
  // Rank should be based on rating (ascending order)
  assertEquals(lowResult.rankInTier, 0)  // lowest rating = rank 0
  assertEquals(midResult.rankInTier, 1)  // middle rating = rank 1
  assertEquals(highResult.rankInTier, 2) // highest rating = rank 2
  
  // Display scores should reflect rank (higher rank = higher score)
  assertEquals(lowResult.displayScore < midResult.displayScore, true)
  assertEquals(midResult.displayScore < highResult.displayScore, true)
  
  // Check exact values for 3 hotels
  assertEquals(lowResult.displayScore, 6.7)  // min
  assertEquals(midResult.displayScore, 8.4)  // midpoint (rounded)
  assertEquals(highResult.displayScore, 10.0) // max
})

Deno.test('computeDisplayScoresForHotels: different tiers scored independently', () => {
  const hotels = [
    { place_id: 'liked1', rating: 1550, sentiment: 'LIKED' as SentimentTier },
    { place_id: 'liked2', rating: 1500, sentiment: 'LIKED' as SentimentTier },
    { place_id: 'fine1', rating: 1480, sentiment: 'FINE' as SentimentTier },
    { place_id: 'disliked1', rating: 1400, sentiment: 'DISLIKED' as SentimentTier },
  ]
  
  const results = computeDisplayScoresForHotels(hotels)
  
  const liked1 = results.find(r => r.place_id === 'liked1')!
  const liked2 = results.find(r => r.place_id === 'liked2')!
  const fine1 = results.find(r => r.place_id === 'fine1')!
  const disliked1 = results.find(r => r.place_id === 'disliked1')!
  
  // Each tier should have correct total count
  assertEquals(liked1.totalInTier, 2)
  assertEquals(liked2.totalInTier, 2)
  assertEquals(fine1.totalInTier, 1)
  assertEquals(disliked1.totalInTier, 1)
  
  // LIKED hotels should be in LIKED band (6.7-10.0)
  assertEquals(liked1.displayScore >= 6.7 && liked1.displayScore <= 10.0, true)
  assertEquals(liked2.displayScore >= 6.7 && liked2.displayScore <= 10.0, true)
  
  // FINE hotel should be in FINE band (midpoint since n=1)
  assertEquals(fine1.displayScore >= 3.4 && fine1.displayScore <= 6.7, true)
  
  // DISLIKED hotel should be in DISLIKED band (midpoint since n=1)
  assertEquals(disliked1.displayScore >= 0.0 && disliked1.displayScore <= 3.4, true)
})

Deno.test('computeDisplayScoresForHotels: ties in Elo handled correctly', () => {
  // Two hotels with same rating - they should get different ranks but same order is deterministic
  const hotels = [
    { place_id: 'hotelA', rating: 1500, sentiment: 'LIKED' as SentimentTier },
    { place_id: 'hotelB', rating: 1500, sentiment: 'LIKED' as SentimentTier },
  ]
  
  const results = computeDisplayScoresForHotels(hotels)
  
  // Both should be in results with totalInTier = 2
  assertEquals(results.length, 2)
  assertEquals(results[0].totalInTier, 2)
  assertEquals(results[1].totalInTier, 2)
  
  // One should have rank 0, other rank 1 (order is deterministic based on array order)
  const ranks = results.map(r => r.rankInTier).sort()
  assertEquals(ranks, [0, 1])
  
  // One should have min score, other max score
  const scores = results.map(r => r.displayScore).sort((a, b) => a - b)
  assertEquals(scores, [6.7, 10.0])
})

Deno.test('computeDisplayScoresForHotels: null sentiment treated as FINE', () => {
  const hotels = [
    { place_id: 'hotel1', rating: 1500, sentiment: null }
  ]
  
  const results = computeDisplayScoresForHotels(hotels)
  
  assertEquals(results.length, 1)
  // Should be in FINE band (midpoint for n=1)
  assertEquals(results[0].displayScore >= 3.4 && results[0].displayScore <= 6.7, true)
})

Deno.test('computeDisplayScoresForHotels: empty array returns empty', () => {
  const results = computeDisplayScoresForHotels([])
  assertEquals(results.length, 0)
})

// =============================================================================
// getDisplayScoreFromResults Tests
// =============================================================================

Deno.test('getDisplayScoreFromResults: finds existing hotel', () => {
  const results = [
    { place_id: 'hotel1', rating: 1500, sentiment: 'LIKED' as SentimentTier, displayScore: 8.5, rankInTier: 0, totalInTier: 1 },
    { place_id: 'hotel2', rating: 1400, sentiment: 'FINE' as SentimentTier, displayScore: 5.0, rankInTier: 0, totalInTier: 1 },
  ]
  
  assertEquals(getDisplayScoreFromResults(results, 'hotel1'), 8.5)
  assertEquals(getDisplayScoreFromResults(results, 'hotel2'), 5.0)
})

Deno.test('getDisplayScoreFromResults: returns null for missing hotel', () => {
  const results = [
    { place_id: 'hotel1', rating: 1500, sentiment: 'LIKED' as SentimentTier, displayScore: 8.5, rankInTier: 0, totalInTier: 1 },
  ]
  
  assertEquals(getDisplayScoreFromResults(results, 'nonexistent'), null)
})

// =============================================================================
// DISPLAY_SCORE_BANDS Tests
// =============================================================================

Deno.test('DISPLAY_SCORE_BANDS: tiers have correct boundaries', () => {
  assertEquals(DISPLAY_SCORE_BANDS.LIKED.min, 6.7)
  assertEquals(DISPLAY_SCORE_BANDS.LIKED.max, 10.0)
  assertEquals(DISPLAY_SCORE_BANDS.FINE.min, 3.4)
  assertEquals(DISPLAY_SCORE_BANDS.FINE.max, 6.7)
  assertEquals(DISPLAY_SCORE_BANDS.DISLIKED.min, 0.0)
  assertEquals(DISPLAY_SCORE_BANDS.DISLIKED.max, 3.4)
})

Deno.test('DISPLAY_SCORE_BANDS: tiers are contiguous', () => {
  // LIKED.min should equal FINE.max
  assertEquals(DISPLAY_SCORE_BANDS.LIKED.min, DISPLAY_SCORE_BANDS.FINE.max)
  // FINE.min should equal DISLIKED.max
  assertEquals(DISPLAY_SCORE_BANDS.FINE.min, DISPLAY_SCORE_BANDS.DISLIKED.max)
})
