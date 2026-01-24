// Elo Battle Pair Edge Function
// POST /elo/get-battle-pair - Get 2 hotels from user's BEEN list for comparison

import { verifyAuth, ApiError, jsonResponse, errorResponse, corsHeaders, handleCors } from '../_shared/utils.ts'

interface BattlePair {
  placeAId: string
  placeBId: string
  placeA?: {
    name: string
    city?: string
    country?: string
    photo?: string
  }
  placeB?: {
    name: string
    city?: string
    country?: string
    photo?: string
  }
}

Deno.serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    // Only allow POST
    if (req.method !== 'POST') {
      throw new ApiError(405, 'Method not allowed')
    }

    // Verify authentication
    const { userId, supabase } = await verifyAuth(req)

    // Get user's BEEN hotels with elo ratings
    const { data: beenHotels, error: queryError } = await supabase
      .from('stays')
      .select(`
        place_id,
        elo_ratings(rating, games_played)
      `)
      .eq('user_id', userId)
      .eq('status', 'BEEN')

    if (queryError) {
      console.error('Query error:', queryError)
      throw new ApiError(500, 'Failed to fetch BEEN hotels')
    }

    if (!beenHotels || beenHotels.length < 2) {
      throw new ApiError(400, 'Need at least 2 BEEN hotels to battle')
    }

    // Flatten and score candidates
    interface Candidate {
      place_id: string
      rating: number
      games_played: number
      score: number // lower is better for selection
    }

    const candidates: Candidate[] = beenHotels
      .map((h: any) => {
        const eloData = Array.isArray(h.elo_ratings) ? h.elo_ratings[0] : h.elo_ratings
        return {
          place_id: h.place_id,
          rating: eloData?.rating || 1500,
          games_played: eloData?.games_played || 0,
        }
      })
      .map((c: any) => ({
        ...c,
        // Prefer low games_played (exploration) + some randomness
        score: c.games_played + Math.random() * 5,
      }))

    // Sort by score and take top candidates
    candidates.sort((a, b) => a.score - b.score)

    // Pick first two, but prefer close ratings if possible
    let placeA = candidates[0]
    let placeB = candidates[1]

    // Try to find a better pair with similar ratings
    for (let i = 0; i < Math.min(5, candidates.length); i++) {
      for (let j = i + 1; j < Math.min(5, candidates.length); j++) {
        const ratingDiff = Math.abs(candidates[i].rating - candidates[j].rating)
        const currentDiff = Math.abs(placeA.rating - placeB.rating)
        
        // Prefer pairs with closer ratings
        if (ratingDiff < currentDiff && (candidates[i].games_played < 10 || candidates[j].games_played < 10)) {
          placeA = candidates[i]
          placeB = candidates[j]
        }
      }
    }

    // Fetch place details from cache
    const { data: placesData } = await supabase
      .from('place_cache')
      .select('place_id, name, city, country, details')
      .in('place_id', [placeA.place_id, placeB.place_id])

    const placeMap = new Map(placesData?.map(p => [p.place_id, p]) || [])

    const result: BattlePair = {
      placeAId: placeA.place_id,
      placeBId: placeB.place_id,
    }

    const placeAData = placeMap.get(placeA.place_id)
    if (placeAData) {
      result.placeA = {
        name: placeAData.name,
        city: placeAData.city,
        country: placeAData.country,
        photo: placeAData.details?.photos?.[0],
      }
    }

    const placeBData = placeMap.get(placeB.place_id)
    if (placeBData) {
      result.placeB = {
        name: placeBData.name,
        city: placeBData.city,
        country: placeBData.country,
        photo: placeBData.details?.photos?.[0],
      }
    }

    return jsonResponse(result)

  } catch (error) {
    return errorResponse(error)
  }
})
