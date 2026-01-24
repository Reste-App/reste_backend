// Rankings Edge Function
// GET /rankings/me - Get user's ranked list of BEEN hotels

import { verifyAuth, ApiError, jsonResponse, errorResponse, corsHeaders, handleCors } from '../_shared/utils.ts'

interface RankedHotel {
  place_id: string
  name: string
  address?: string
  city?: string
  country?: string
  chain?: string
  rating: number // Elo rating
  games_played: number
  sentiment: string
  score10: number // Computed score out of 10 (Beli-style tiers)
  tier: string // LIKED | FINE | DISLIKED
  stayed_at?: string
  photo?: string
}

// Beli-style tier boundaries (score out of 10)
const TIERS = {
  LIKED:    { min: 6.7, max: 10.0 },  // Top tier
  FINE:     { min: 3.4, max: 6.6 },   // Middle tier
  DISLIKED: { min: 0.0, max: 3.3 },   // Bottom tier
}

/**
 * Calculate score out of 10 using Beli-style tiers
 * - Sentiment determines which tier (LIKED: 6.7-10, FINE: 3.4-6.6, DISLIKED: 0-3.3)
 * - Elo rating determines position within that tier
 */
function calculateScore10(rating: number, sentiment: string | null): number {
  // Normalize Elo to 0-1 scale (1000 = 0, 2000 = 1)
  const normalizedElo = Math.max(0, Math.min(1, (rating - 1000) / 1000))
  
  // Get tier based on sentiment
  const tier = TIERS[sentiment as keyof typeof TIERS] || TIERS.FINE
  const tierRange = tier.max - tier.min
  
  // Map normalized Elo to position within tier
  const score = tier.min + (normalizedElo * tierRange)
  
  return Math.round(score * 10) / 10 // Round to 1 decimal
}

Deno.serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    // Only allow GET
    if (req.method !== 'GET') {
      throw new ApiError(405, 'Method not allowed')
    }

    // Verify authentication
    const { userId, supabase } = await verifyAuth(req)

    // Get user's BEEN hotels with elo ratings and place cache
    const { data: stays, error: queryError } = await supabase
      .from('stays')
      .select(`
        place_id,
        sentiment,
        stayed_at,
        elo_ratings (
          rating,
          games_played
        ),
        place_cache (
          name,
          city,
          country,
          chain,
          details
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'BEEN')

    if (queryError) {
      console.error('Query error:', queryError)
      throw new ApiError(500, 'Failed to fetch rankings')
    }

    if (!stays || stays.length === 0) {
      return jsonResponse({ rankings: [] })
    }

    // Transform and calculate scores
    const rankings: RankedHotel[] = stays.map((stay: any) => {
      const eloData = Array.isArray(stay.elo_ratings) ? stay.elo_ratings[0] : stay.elo_ratings
      const placeData = Array.isArray(stay.place_cache) ? stay.place_cache[0] : stay.place_cache
      
      const rating = eloData?.rating || 1500
      const gamesPlayed = eloData?.games_played || 0
      const sentiment = stay.sentiment
      const score10 = calculateScore10(rating, sentiment)

      return {
        place_id: stay.place_id,
        name: placeData?.name || 'Unknown Hotel',
        city: placeData?.city,
        country: placeData?.country,
        chain: placeData?.chain,
        rating,
        games_played: gamesPlayed,
        sentiment,
        score10,
        tier: sentiment || 'FINE',
        stayed_at: stay.stayed_at,
        photo: placeData?.details?.photos?.[0],
      }
    })

    // Sort by score10 descending (respects Beli-style tiers)
    // LIKED hotels always on top, then FINE, then DISLIKED
    // Within each tier, sorted by Elo (reflected in score10)
    rankings.sort((a, b) => b.score10 - a.score10)

    return jsonResponse({
      rankings,
      total: rankings.length,
    })

  } catch (error) {
    return errorResponse(error)
  }
})
