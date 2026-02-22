import {
  verifyAuth,
  ApiError,
  jsonResponse,
  errorResponse,
  handleCors,
  computeDisplayScore,
  DISPLAY_SCORE_BANDS,
  type SentimentTier,
} from '../_shared/utils.ts'

const TIER_ORDER: SentimentTier[] = ['LIKED', 'FINE', 'DISLIKED']

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    if (req.method !== 'GET') {
      throw new ApiError(405, 'Method not allowed')
    }

    const { userId, supabase } = await verifyAuth(req)

    const { data: stays, error: queryError } = await supabase
      .from('stays')
      .select(`
        place_id,
        sentiment,
        rank_in_tier,
        stayed_at,
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
      return jsonResponse({ rankings: [], total: 0 })
    }

    // Count placed hotels per tier for display score calculation
    const tierCounts = new Map<string, number>()
    for (const s of stays) {
      if (s.rank_in_tier !== null && s.sentiment) {
        tierCounts.set(s.sentiment, (tierCounts.get(s.sentiment) ?? 0) + 1)
      }
    }

    const rankings = stays.map((stay: any) => {
      const placeData = Array.isArray(stay.place_cache)
        ? stay.place_cache[0]
        : stay.place_cache

      const sentiment = (stay.sentiment as SentimentTier) || 'FINE'
      const totalInTier = tierCounts.get(sentiment) ?? 0
      const ranked = stay.rank_in_tier !== null
      const displayScore = ranked
        ? computeDisplayScore(stay.rank_in_tier, totalInTier, sentiment)
        : null

      return {
        place_id: stay.place_id,
        name: placeData?.name || 'Unknown Hotel',
        city: placeData?.city,
        country: placeData?.country,
        chain: placeData?.chain,
        sentiment,
        tier: sentiment,
        rankInTier: stay.rank_in_tier,
        displayScore,
        stayed_at: stay.stayed_at,
        photo: placeData?.details?.photos?.[0],
      }
    })

    // Sort: LIKED desc by rank, then FINE desc, then DISLIKED desc.
    // Unranked hotels (displayScore === null) go at the end.
    rankings.sort((a: any, b: any) => {
      if (a.displayScore === null && b.displayScore === null) return 0
      if (a.displayScore === null) return 1
      if (b.displayScore === null) return -1
      return b.displayScore - a.displayScore
    })

    return jsonResponse({ rankings, total: rankings.length })
  } catch (error) {
    return errorResponse(error)
  }
})
