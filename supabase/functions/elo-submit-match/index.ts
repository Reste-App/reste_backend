// Elo Submit Match Edge Function
// POST /elo/submit-match - Record pairwise comparison and update Elo ratings
// Uses dynamic K-factor and standard Elo formula

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'
import { 
  verifyAuth, 
  ApiError, 
  jsonResponse, 
  errorResponse, 
  corsHeaders, 
  handleCors,
  ELO_K_BASE,
  ELO_K_MIN,
  PLACEMENT_MAX_COMPARISONS,
  PLACEMENT_STABLE_THRESHOLD,
  updateStoredDisplayScores,
} from '../_shared/utils.ts'

const SubmitMatchSchema = z.object({
  placeAId: z.string().min(1),
  placeBId: z.string().min(1),
  winnerPlaceId: z.string().min(1),
  // Optional: ID of the hotel being actively placed (usually placeA)
  activeHotelId: z.string().optional(),
}).refine(
  (data) => data.winnerPlaceId === data.placeAId || data.winnerPlaceId === data.placeBId,
  { message: 'Winner must be either placeA or placeB' }
)

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
    // We'll use a PostgreSQL function for atomic updates with dynamic K-factor

    const { data: result, error: txError } = await supabaseAdmin.rpc('update_elo_ratings', {
      p_user_id: userId,
      p_place_a: data.placeAId,
      p_place_b: data.placeBId,
      p_winner: data.winnerPlaceId,
      p_k_base: ELO_K_BASE,
      p_k_min: ELO_K_MIN,
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

    // Update placement session for active hotel (Beli-like stopping)
    // Use placeA as the active hotel if not explicitly provided (placeA is always the "new" hotel)
    const activeHotelId = data.activeHotelId || data.placeAId
    let placementResult: { is_placed: boolean; comparisons_done: number; rank_position: number; stable_steps: number } | null = null

    try {
      // Call the SQL function to update placement session
      const { data: sessionResult, error: sessionError } = await supabaseAdmin.rpc('update_placement_session', {
        p_user_id: userId,
        p_place_id: activeHotelId,
        p_max_comparisons: PLACEMENT_MAX_COMPARISONS,
        p_stable_threshold: PLACEMENT_STABLE_THRESHOLD,
      })

      if (sessionError) {
        console.error('Placement session update error:', sessionError)
      } else {
        placementResult = sessionResult
      }
    } catch (err) {
      console.error('Placement session update failed:', err)
      // Non-fatal, continue
    }

    // Update stored display scores for all user's hotels (tier-percentile based)
    // This ensures scores are cached in DB for efficient reads
    await updateStoredDisplayScores(supabaseAdmin, userId)

    // Fetch updated ratings with stored display scores for the matched pair
    const { data: updatedRatings } = await supabase
      .from('elo_ratings')
      .select('place_id, rating, games_played, display_score')
      .eq('user_id', userId)
      .in('place_id', [data.placeAId, data.placeBId])

    const ratingsWithScores = (updatedRatings || []).map(r => ({
      place_id: r.place_id,
      rating: r.rating,
      games_played: r.games_played,
      displayScore: r.display_score ?? 5.0,
      // Keep score10 for backward compatibility
      score10: r.display_score ?? 5.0,
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
      kFactor: result?.k_factor,
      ratings: ratingsWithScores,
      // Placement session result (Beli-like stopping)
      placementSession: placementResult ? {
        activeHotelId,
        isPlaced: placementResult.is_placed,
        comparisonsRemaining: Math.max(0, PLACEMENT_MAX_COMPARISONS - placementResult.comparisons_done),
        rankPosition: placementResult.rank_position,
        stableSteps: placementResult.stable_steps,
      } : undefined,
    })

  } catch (error) {
    return errorResponse(error)
  }
})
