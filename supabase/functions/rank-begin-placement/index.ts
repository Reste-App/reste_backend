import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'
import {
  verifyAuth,
  ApiError,
  jsonResponse,
  errorResponse,
  handleCors,
  computeDisplayScore,
  type SentimentTier,
} from '../_shared/utils.ts'

const BeginPlacementSchema = z.object({
  placeId: z.string().min(1),
  sentiment: z.enum(['LIKED', 'FINE', 'DISLIKED']),
})

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    if (req.method !== 'POST') {
      throw new ApiError(405, 'Method not allowed')
    }

    const { userId, supabase } = await verifyAuth(req)

    const body = await req.json()
    const data = BeginPlacementSchema.parse(body)
    const sentiment = data.sentiment as SentimentTier

    // Verify hotel is in the user's BEEN list with matching sentiment
    const { data: stay, error: stayError } = await supabase
      .from('stays')
      .select('place_id, sentiment, rank_in_tier')
      .eq('user_id', userId)
      .eq('place_id', data.placeId)
      .eq('status', 'BEEN')
      .eq('sentiment', sentiment)
      .single()

    if (stayError || !stay) {
      throw new ApiError(400, 'Hotel not found in your BEEN list with that sentiment')
    }

    if (stay.rank_in_tier !== null) {
      throw new ApiError(400, 'Hotel is already ranked. Reset first to re-rank.')
    }

    // Fetch all placed hotels in this tier, ordered by rank ascending
    const { data: tierHotels, error: tierError } = await supabase
      .from('stays')
      .select('place_id, rank_in_tier')
      .eq('user_id', userId)
      .eq('status', 'BEEN')
      .eq('sentiment', sentiment)
      .not('rank_in_tier', 'is', null)
      .order('rank_in_tier', { ascending: true })

    if (tierError) {
      throw new ApiError(500, 'Failed to fetch tier list')
    }

    const totalInTier = tierHotels?.length ?? 0

    // First hotel in tier — place immediately at rank 0
    if (totalInTier === 0) {
      const { error: updateError } = await supabase
        .from('stays')
        .update({ rank_in_tier: 0, rank_updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('place_id', data.placeId)

      if (updateError) {
        throw new ApiError(500, 'Failed to place hotel')
      }

      const displayScore = computeDisplayScore(0, 1, sentiment)

      return jsonResponse({ status: 'placed', rankInTier: 0, displayScore })
    }

    // Multiple hotels exist — fetch place details for the tier list + the new hotel
    const tierPlaceIds = tierHotels!.map((h: any) => h.place_id)
    const allPlaceIds = [...tierPlaceIds, data.placeId]

    const { data: placeDetails } = await supabase
      .from('place_cache')
      .select('place_id, name, details')
      .in('place_id', allPlaceIds)

    const placeMap = new Map(
      (placeDetails || []).map((p: any) => [p.place_id, p]),
    )

    const tierList = tierHotels!.map((h: any) => {
      const place = placeMap.get(h.place_id)
      return {
        placeId: h.place_id,
        name: place?.name || 'Unknown',
        photo: place?.details?.photos?.[0] ?? null,
      }
    })

    const newPlace = placeMap.get(data.placeId)
    const newHotel = {
      placeId: data.placeId,
      name: newPlace?.name || 'Unknown',
      photo: newPlace?.details?.photos?.[0] ?? null,
    }

    return jsonResponse({
      status: 'comparing',
      tierList,
      totalInTier,
      newHotel,
    })
  } catch (error) {
    return errorResponse(error)
  }
})
