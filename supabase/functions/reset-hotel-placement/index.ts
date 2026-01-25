// Reset Hotel Placement Edge Function
// POST /reset-hotel-placement - Reset a hotel's placement session and Elo rating to default
// This allows the hotel to be re-ranked from scratch

import { 
  verifyAuth, 
  ApiError, 
  jsonResponse, 
  errorResponse, 
  corsHeaders, 
  handleCors,
  ELO_SEED,
} from '../_shared/utils.ts'
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'

const ResetPlacementSchema = z.object({
  placeId: z.string().min(1),
})

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
    const data = ResetPlacementSchema.parse(body)

    // Verify the hotel is in user's BEEN list
    const { data: stay, error: stayError } = await supabase
      .from('stays')
      .select('place_id, sentiment')
      .eq('user_id', userId)
      .eq('place_id', data.placeId)
      .eq('status', 'BEEN')
      .single()

    if (stayError || !stay) {
      throw new ApiError(400, 'Hotel not found in your BEEN list')
    }

    // Get the default Elo rating based on sentiment
    const sentiment = stay.sentiment || 'FINE'
    const defaultRating = ELO_SEED[sentiment as keyof typeof ELO_SEED] || ELO_SEED.FINE

    // Reset the Elo rating to default
    const { error: eloError } = await supabaseAdmin
      .from('elo_ratings')
      .upsert({
        user_id: userId,
        place_id: data.placeId,
        rating: defaultRating,
        games_played: 0,
        display_score: null, // Will be recalculated
      }, {
        onConflict: 'user_id,place_id',
      })

    if (eloError) {
      console.error('Error resetting Elo rating:', eloError)
      throw new ApiError(500, 'Failed to reset rating')
    }

    // Delete the placement session to allow re-ranking
    const { error: placementError } = await supabaseAdmin
      .from('placement_sessions')
      .delete()
      .eq('user_id', userId)
      .eq('place_id', data.placeId)

    if (placementError) {
      console.error('Error deleting placement session:', placementError)
      // Non-fatal, continue
    }

    // Delete all comparison matches involving this hotel
    const { error: matchesError } = await supabaseAdmin
      .from('elo_matches')
      .delete()
      .eq('user_id', userId)
      .or(`place_a.eq.${data.placeId},place_b.eq.${data.placeId}`)

    if (matchesError) {
      console.error('Error deleting matches:', matchesError)
      // Non-fatal, continue
    }

    return jsonResponse({
      success: true,
      message: 'Hotel placement reset successfully',
      placeId: data.placeId,
      resetRating: defaultRating,
    })

  } catch (error) {
    return errorResponse(error)
  }
})
