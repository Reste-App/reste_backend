// Rankings Edge Function
// GET /rankings/me - Get user's ranked list of BEEN hotels

import { 
  verifyAuth, 
  ApiError, 
  jsonResponse, 
  errorResponse, 
  corsHeaders, 
  handleCors,
} from '../_shared/utils.ts'

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
  score10: number // Computed score out of 10 (tier-percentile based)
  tier: string // LIKED | FINE | DISLIKED
  stayed_at?: string
  photo?: string
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

    // Get user's BEEN hotels with elo ratings (including stored display_score) and place cache
    const { data: stays, error: queryError } = await supabase
      .from('stays')
      .select(`
        place_id,
        sentiment,
        stayed_at,
        elo_ratings (
          rating,
          games_played,
          display_score
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

    // Transform stays into rankings using stored display_score from elo_ratings
    const rankings: RankedHotel[] = stays.map((stay: any) => {
      const eloData = Array.isArray(stay.elo_ratings) ? stay.elo_ratings[0] : stay.elo_ratings
      const placeData = Array.isArray(stay.place_cache) ? stay.place_cache[0] : stay.place_cache
      
      const rating = eloData?.rating || 1500
      const gamesPlayed = eloData?.games_played || 0
      const sentiment = stay.sentiment
      // Use the stored display_score from elo_ratings (updated after each comparison)
      const score10 = eloData?.display_score ?? 5.0

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
    // Within each tier, sorted by percentile rank (reflected in score10)
    rankings.sort((a, b) => b.score10 - a.score10)

    return jsonResponse({
      rankings,
      total: rankings.length,
    })

  } catch (error) {
    return errorResponse(error)
  }
})
