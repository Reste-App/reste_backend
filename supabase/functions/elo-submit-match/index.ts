// Elo Submit Match Edge Function
// POST /elo/submit-match - Record pairwise comparison and update Elo ratings

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'
import { verifyAuth, ApiError, jsonResponse, errorResponse, corsHeaders, handleCors } from '../_shared/utils.ts'

const SubmitMatchSchema = z.object({
  placeAId: z.string().min(1),
  placeBId: z.string().min(1),
  winnerPlaceId: z.string().min(1),
}).refine(
  (data) => data.winnerPlaceId === data.placeAId || data.winnerPlaceId === data.placeBId,
  { message: 'Winner must be either placeA or placeB' }
)

const ELO_K = 24

/**
 * Calculate expected score for player A vs player B
 */
function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400))
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
    // Only allow POST
    if (req.method !== 'POST') {
      throw new ApiError(405, 'Method not allowed')
    }

    // Verify authentication
    const { userId, supabase, supabaseAdmin } = await verifyAuth(req)

    // Parse and validate body
    const body = await req.json()
    const data = SubmitMatchSchema.parse(body)

    // Verify both places are in user's BEEN list
    const { data: stays, error: staysError } = await supabase
      .from('stays')
      .select('place_id, sentiment')
      .eq('user_id', userId)
      .eq('status', 'BEEN')
      .in('place_id', [data.placeAId, data.placeBId])

    if (staysError || !stays || stays.length !== 2) {
      throw new ApiError(400, 'Both places must be in your BEEN list')
    }

    const sentimentMap = new Map(stays.map(s => [s.place_id, s.sentiment]))

    // Perform transaction: fetch ratings, calculate updates, write back
    // Note: Supabase Edge Functions don't have native transaction support via JS client
    // We'll use a PostgreSQL function for atomic updates

    const { data: result, error: txError } = await supabaseAdmin.rpc('update_elo_ratings', {
      p_user_id: userId,
      p_place_a: data.placeAId,
      p_place_b: data.placeBId,
      p_winner: data.winnerPlaceId,
      p_k_factor: ELO_K,
    })

    if (txError) {
      console.error('Elo update error:', txError)
      throw new ApiError(500, `Failed to update ratings: ${txError.message}`)
    }

    // Insert match record
    const { error: matchError } = await supabase
      .from('elo_matches')
      .insert({
        user_id: userId,
        place_a: data.placeAId,
        place_b: data.placeBId,
        winner_place_id: data.winnerPlaceId,
      })

    if (matchError) {
      console.error('Match insert error:', matchError)
      // Non-fatal, continue
    }

    // Get updated ratings
    const { data: updatedRatings } = await supabase
      .from('elo_ratings')
      .select('place_id, rating, games_played')
      .eq('user_id', userId)
      .in('place_id', [data.placeAId, data.placeBId])

    // Calculate score10 for both
    const ratingsWithScores = updatedRatings?.map(r => ({
      place_id: r.place_id,
      rating: r.rating,
      games_played: r.games_played,
      score10: calculateScore10(r.rating, sentimentMap.get(r.place_id) || null),
    }))

    // Get place names for feed event
    const { data: places } = await supabase
      .from('place_cache')
      .select('place_id, name')
      .in('place_id', [data.placeAId, data.placeBId])

    const placeNames = new Map(places?.map(p => [p.place_id, p.name]) || [])

    // Get user profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', userId)
      .single()

    // Create feed event
    const { error: feedError } = await supabaseAdmin
      .from('feed_events')
      .insert({
        actor_id: userId,
        event_type: 'ELO_MATCH',
        payload: {
          username: profile?.username || 'unknown',
          place_a: data.placeAId,
          place_b: data.placeBId,
          winner: data.winnerPlaceId,
          place_a_name: placeNames.get(data.placeAId),
          place_b_name: placeNames.get(data.placeBId),
          winner_name: placeNames.get(data.winnerPlaceId),
        },
      })

    if (feedError) {
      console.error('Feed event error:', feedError)
      // Non-fatal
    }

    return jsonResponse({
      success: true,
      ratings: ratingsWithScores,
    })

  } catch (error) {
    return errorResponse(error)
  }
})
