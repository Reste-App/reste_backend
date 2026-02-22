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

const FinalizePlacementSchema = z.object({
  placeId: z.string().min(1),
  sentiment: z.enum(['LIKED', 'FINE', 'DISLIKED']),
  rankInTier: z.number().int().min(0),
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
    const data = FinalizePlacementSchema.parse(body)
    const sentiment = data.sentiment as SentimentTier

    // Count current placed hotels in this tier (to validate rankInTier range)
    const { count, error: countError } = await supabaseAdmin
      .from('stays')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'BEEN')
      .eq('sentiment', sentiment)
      .not('rank_in_tier', 'is', null)

    if (countError) {
      throw new ApiError(500, 'Failed to count tier hotels')
    }

    const currentTotal = count ?? 0

    // Clamp rankInTier to valid range [0, currentTotal]
    const rankInTier = Math.min(data.rankInTier, currentTotal)

    const { error: rpcError } = await supabaseAdmin.rpc('rank_finalize_placement', {
      p_user_id: userId,
      p_place_id: data.placeId,
      p_sentiment: sentiment,
      p_rank_in_tier: rankInTier,
    })

    if (rpcError) {
      console.error('rank_finalize_placement rpc error:', rpcError)
      throw new ApiError(500, `Failed to finalize placement: ${rpcError.message}`)
    }

    const newTotal = currentTotal + 1
    const displayScore = computeDisplayScore(rankInTier, newTotal, sentiment)

    return jsonResponse({
      status: 'placed',
      rankInTier,
      totalInTier: newTotal,
      displayScore,
    })
  } catch (error) {
    return errorResponse(error)
  }
})
