// Shared utilities for Supabase Edge Functions
// Auth verification, Supabase clients, error handling, Elo utilities

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

// =============================================================================
// Configuration Constants
// =============================================================================

/** Minimum number of marked (BEEN) hotels required to enable comparisons */
export const MARK_THRESHOLD = 5

/** Base K-factor for Elo updates */
export const ELO_K_BASE = 24

/** Minimum K-factor (decreases as games_played increases) */
export const ELO_K_MIN = 12

/** Elo seeding values based on sentiment/mark */
export const ELO_SEED = {
  LIKED: 1550,
  FINE: 1500,
  DISLIKED: 1450,
} as const

// =============================================================================
// Placement Session Constants (Beli-like stopping behavior)
// =============================================================================

/** Maximum comparisons before forcing placement (hard UX cap) */
export const PLACEMENT_MAX_COMPARISONS = 4

/** Number of stable rank positions needed to trigger placement */
export const PLACEMENT_STABLE_THRESHOLD = 2

/** Elo rating ranges for each sentiment tier (for tier-based neighbor selection) */
export const ELO_TIER_RANGES = {
  LIKED: { min: 1525, max: 1700 },    // Center around 1550
  FINE: { min: 1475, max: 1525 },      // Center around 1500
  DISLIKED: { min: 1300, max: 1475 },  // Center around 1450
} as const

/**
 * Get the sentiment tier for a given Elo rating
 */
export function getSentimentTier(rating: number): 'LIKED' | 'FINE' | 'DISLIKED' {
  if (rating >= ELO_TIER_RANGES.LIKED.min) return 'LIKED'
  if (rating >= ELO_TIER_RANGES.FINE.min) return 'FINE'
  return 'DISLIKED'
}

// =============================================================================
// Elo Utilities
// =============================================================================

/**
 * Display score bands by sentiment tier (Beli-style)
 */
export const DISPLAY_SCORE_BANDS = {
  LIKED: { min: 6.7, max: 10.0 },
  FINE: { min: 3.4, max: 6.7 },
  DISLIKED: { min: 0.0, max: 3.4 },
} as const

export type SentimentTier = 'LIKED' | 'FINE' | 'DISLIKED'

/**
 * @deprecated Use computePercentileDisplayScore for tier-percentile based scoring
 * Legacy sigmoid-based display score calculation
 */
export function eloToDisplayScore(rating: number): number {
  const score = 10 * (1 / (1 + Math.exp(-(rating - 1500) / 200)))
  return Math.round(score * 10) / 10 // Round to 1 decimal
}

/**
 * Compute percentile-based display score for a hotel within its sentiment tier
 * 
 * @param rankIndex - 0-based rank index (0 = lowest rating in tier)
 * @param totalInTier - Total number of hotels in the tier
 * @param sentiment - The sentiment tier (LIKED, FINE, DISLIKED)
 * @returns Display score (0.0 - 10.0), rounded to 1 decimal
 */
export function computePercentileDisplayScore(
  rankIndex: number,
  totalInTier: number,
  sentiment: SentimentTier | null
): number {
  const tier = sentiment || 'FINE'
  const band = DISPLAY_SCORE_BANDS[tier] || DISPLAY_SCORE_BANDS.FINE
  
  // Compute percentile: p = rankIndex / max(1, n-1)
  // For n=1: p=0 -> score is band midpoint
  // For n=2: indices 0,1 -> p=0, p=1 -> min, max
  const n = Math.max(1, totalInTier)
  const percentile = n <= 1 ? 0.5 : rankIndex / (n - 1)
  
  // Map percentile to band
  const displayScore = band.min + percentile * (band.max - band.min)
  
  // Round to 1 decimal and clamp to [0, 10]
  return Math.round(Math.max(0, Math.min(10, displayScore)) * 10) / 10
}

/**
 * Result type for batch display score computation
 */
export interface HotelDisplayScoreResult {
  place_id: string
  rating: number
  sentiment: SentimentTier | null
  displayScore: number
  rankInTier: number
  totalInTier: number
}

/**
 * Compute display scores for a list of hotels using tier-percentile method
 * Hotels are grouped by sentiment tier, sorted by Elo within each tier,
 * and assigned display scores based on their percentile rank within the tier.
 * 
 * @param hotels - Array of hotels with place_id, rating, and sentiment
 * @returns Array of hotels with computed displayScore and rank info
 */
export function computeDisplayScoresForHotels(
  hotels: Array<{ place_id: string; rating: number; sentiment: SentimentTier | null }>
): HotelDisplayScoreResult[] {
  // Group hotels by sentiment tier
  const tierGroups = new Map<SentimentTier, typeof hotels>()
  
  for (const hotel of hotels) {
    const tier = (hotel.sentiment as SentimentTier) || 'FINE'
    if (!tierGroups.has(tier)) {
      tierGroups.set(tier, [])
    }
    tierGroups.get(tier)!.push(hotel)
  }
  
  const results: HotelDisplayScoreResult[] = []
  
  // Process each tier
  for (const [tier, tierHotels] of tierGroups) {
    // Sort by rating ascending (lowest = rank 0)
    const sorted = [...tierHotels].sort((a, b) => a.rating - b.rating)
    const totalInTier = sorted.length
    
    // Compute display scores for each hotel in this tier
    for (let i = 0; i < sorted.length; i++) {
      const hotel = sorted[i]
      const displayScore = computePercentileDisplayScore(i, totalInTier, tier)
      
      results.push({
        place_id: hotel.place_id,
        rating: hotel.rating,
        sentiment: hotel.sentiment,
        displayScore,
        rankInTier: i,
        totalInTier,
      })
    }
  }
  
  return results
}

/**
 * Get display score for specific hotels from a pre-computed results array
 */
export function getDisplayScoreFromResults(
  results: HotelDisplayScoreResult[],
  placeId: string
): number | null {
  const result = results.find(r => r.place_id === placeId)
  return result?.displayScore ?? null
}

/**
 * Update stored display scores for all hotels in the user's collection.
 * Call this after any rating change (new stay, elo match).
 * 
 * @param supabase - Supabase client (admin recommended for bypassing RLS)
 * @param userId - User ID
 * @returns Number of records updated
 */
export async function updateStoredDisplayScores(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<number> {
  // Fetch all BEEN hotels with ratings and sentiments
  const { data: stays, error: staysError } = await supabase
    .from('stays')
    .select(`
      place_id,
      sentiment,
      elo_ratings (
        rating
      )
    `)
    .eq('user_id', userId)
    .eq('status', 'BEEN')

  if (staysError || !stays || stays.length === 0) {
    return 0
  }

  // Build hotels array for scoring
  const hotelsForScoring = stays.map((stay: any) => {
    const eloData = Array.isArray(stay.elo_ratings) ? stay.elo_ratings[0] : stay.elo_ratings
    return {
      place_id: stay.place_id,
      rating: eloData?.rating || 1500,
      sentiment: (stay.sentiment || 'FINE') as SentimentTier,
    }
  })

  // Compute display scores
  const displayScoreResults = computeDisplayScoresForHotels(hotelsForScoring)

  // Batch update elo_ratings with computed display scores
  let updatedCount = 0
  for (const result of displayScoreResults) {
    const { error } = await supabase
      .from('elo_ratings')
      .update({ display_score: result.displayScore })
      .eq('user_id', userId)
      .eq('place_id', result.place_id)

    if (!error) {
      updatedCount++
    }
  }

  return updatedCount
}

/**
 * Calculate dynamic K-factor based on games played
 * K decreases as player has more games, making ratings more stable
 * Formula: max(K_MIN, K_BASE - games_played / 10)
 */
export function dynamicKFactor(gamesPlayed: number): number {
  return Math.max(ELO_K_MIN, ELO_K_BASE - gamesPlayed / 10)
}

/**
 * Calculate expected score for player A vs player B (standard Elo formula)
 */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400))
}

/**
 * Get seed Elo rating from sentiment value
 */
export function getSeedRating(sentiment: string | null): number {
  if (sentiment === 'LIKED') return ELO_SEED.LIKED
  if (sentiment === 'DISLIKED') return ELO_SEED.DISLIKED
  return ELO_SEED.FINE
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = ReturnType<typeof createClient<any>>

export interface AuthContext {
  userId: string
  supabase: SupabaseClient
  supabaseAdmin: SupabaseClient
}

/**
 * Verify JWT token and return authenticated user ID + Supabase clients
 */
export async function verifyAuth(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ApiError(401, 'Missing or invalid Authorization header')
  }

  const token = authHeader.replace('Bearer ', '')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Client for user-scoped operations (with RLS)
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  // Admin client for service-level operations (bypasses RLS)
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

  // Verify token and get user
  const { data: { user }, error } = await supabase.auth.getUser(token)
  
  if (error || !user) {
    throw new ApiError(401, 'Invalid or expired token')
  }

  return {
    userId: user.id,
    supabase,
    supabaseAdmin,
  }
}

/**
 * Custom API error class
 */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Standard JSON response helper with CORS headers
 */
export function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  })
}

/**
 * Error response helper with CORS headers
 */
export function errorResponse(error: unknown): Response {
  console.error('Error:', error)
  
  if (error instanceof ApiError) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.status,
      headers: { 
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    })
  }
  
  if (error instanceof Error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    })
  }
  
  return new Response(JSON.stringify({ error: 'Internal server error' }), {
    status: 500,
    headers: { 
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  })
}

/**
 * CORS headers for edge functions
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Handle CORS preflight
 */
export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return null
}
