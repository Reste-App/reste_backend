import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'
import {
  verifyAuth,
  ApiError,
  jsonResponse,
  errorResponse,
  handleCors,
} from '../_shared/utils.ts'

const RankResetSchema = z.object({
  placeId: z.string().min(1),
})

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    if (req.method !== 'POST') {
      throw new ApiError(405, 'Method not allowed')
    }

    const { userId, supabaseAdmin } = await verifyAuth(req)

    const body = await req.json()
    const data = RankResetSchema.parse(body)

    // Fetch the hotel to get its current rank and sentiment
    const { data: stay, error: stayError } = await supabaseAdmin
      .from('stays')
      .select('place_id, sentiment, rank_in_tier')
      .eq('user_id', userId)
      .eq('place_id', data.placeId)
      .eq('status', 'BEEN')
      .single()

    if (stayError || !stay) {
      throw new ApiError(400, 'Hotel not found in your BEEN list')
    }

    if (stay.rank_in_tier === null) {
      return jsonResponse({ success: true, message: 'Hotel was already unranked' })
    }

    const oldRank = stay.rank_in_tier
    const sentiment = stay.sentiment

    // Use rpc for atomic shift-down + clear
    const { error: rpcError } = await supabaseAdmin.rpc('rank_reset_placement', {
      p_user_id: userId,
      p_place_id: data.placeId,
      p_sentiment: sentiment,
      p_old_rank: oldRank,
    })

    if (rpcError) {
      console.error('rank_reset_placement rpc error:', rpcError)
      throw new ApiError(500, `Failed to reset placement: ${rpcError.message}`)
    }

    return jsonResponse({
      success: true,
      message: 'Hotel placement reset successfully',
      placeId: data.placeId,
    })
  } catch (error) {
    return errorResponse(error)
  }
})
