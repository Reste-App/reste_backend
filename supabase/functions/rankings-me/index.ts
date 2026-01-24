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
  score10: number // Computed score out of 10
  stayed_at?: string
  photo?: string
}

/**
 * Calculate sentiment offset for score10
 */
function sentimentOffset(sentiment: string | null): number {
  switch (sentiment) {
    case 'LIKED': return 0.7
    case 'DISLIKED': return -0.7
    case 'FINE':
    default: return 0.0
  }
}

/**
 * Calculate score out of 10 from Elo rating and sentiment
 */
function calculateScore10(rating: number, sentiment: string | null): number {
  const base10 = Math.max(0, Math.min(10, (rating - 1000) / 100))
  const offset = sentimentOffset(sentiment)
  return Math.max(0, Math.min(10, base10 + offset))
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
        score10: Math.round(score10 * 10) / 10, // Round to 1 decimal
        stayed_at: stay.stayed_at,
        photo: placeData?.details?.photos?.[0],
      }
    })

    // Sort by rating descending (primary ordering)
    rankings.sort((a, b) => b.rating - a.rating)

    return jsonResponse({
      rankings,
      total: rankings.length,
    })

  } catch (error) {
    return errorResponse(error)
  }
})
