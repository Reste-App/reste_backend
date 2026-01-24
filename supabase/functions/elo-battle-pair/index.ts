// Elo Battle Pair Edge Function
// POST /elo/get-battle-pair - Get 2 hotels from user's BEEN list for comparison
// With threshold gating, smart pair selection, and display scores

import { 
  verifyAuth, 
  ApiError, 
  jsonResponse, 
  errorResponse, 
  corsHeaders, 
  handleCors, 
  MARK_THRESHOLD, 
  getSentimentTier,
  PLACEMENT_MAX_COMPARISONS,
  computeDisplayScoresForHotels,
  getDisplayScoreFromResults,
  type SentimentTier,
} from '../_shared/utils.ts'

interface PlaceInfo {
  name: string
  city?: string
  country?: string
  photo?: string
  rating: number
  displayScore: number
  gamesPlayed: number
}

interface BattlePairResponse {
  enabled: boolean
  remaining?: number
  pair?: {
    placeAId: string
    placeBId: string
    placeA?: PlaceInfo
    placeB?: PlaceInfo
  }
  // Placement session info (when active hotel is being placed)
  placementSession?: {
    activeHotelId: string
    comparisonsRemaining: number
    isPlaced: boolean
  }
  // When no comparison needed (active hotel is placed or no active hotel)
  noComparisonNeeded?: boolean
}

interface Candidate {
  place_id: string
  rating: number
  games_played: number
  sentiment?: string | null
}

/** Days to look back for recent pair avoidance */
const RECENT_PAIR_DAYS = 30

/** Number of candidates to consider for pair selection */
const CANDIDATE_POOL_SIZE = 30

/** Max retries when avoiding recent pairs */
const MAX_PAIR_RETRIES = 5

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

    // Parse body to get optional includePlace parameter
    let includePlace: string | null = null
    let forceComparison = false // If true, skip placement check
    try {
      const body = await req.json()
      includePlace = body.includePlace || null
      forceComparison = body.forceComparison === true
    } catch {
      // Body is optional, ignore parse errors
    }

    // Get count of user's BEEN hotels (marked hotels)
    const { count: markedCount, error: countError } = await supabase
      .from('stays')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'BEEN')

    if (countError) {
      console.error('Count error:', countError)
      throw new ApiError(500, 'Failed to count marked hotels')
    }

    const totalMarked = markedCount ?? 0

    // Threshold gating: check if user has enough marked hotels
    if (totalMarked < MARK_THRESHOLD) {
      return jsonResponse({
        enabled: false,
        remaining: MARK_THRESHOLD - totalMarked,
      } satisfies BattlePairResponse)
    }

    // Need at least 2 hotels for comparison
    if (totalMarked < 2) {
      return jsonResponse({
        enabled: false,
        remaining: 2 - totalMarked,
      } satisfies BattlePairResponse)
    }

    // Get user's BEEN hotels with sentiment
    const { data: beenHotels, error: staysError } = await supabase
      .from('stays')
      .select('place_id, sentiment')
      .eq('user_id', userId)
      .eq('status', 'BEEN')
      .limit(CANDIDATE_POOL_SIZE * 2)

    if (staysError) {
      console.error('Stays query error:', staysError)
      throw new ApiError(500, 'Failed to fetch BEEN hotels')
    }

    if (!beenHotels || beenHotels.length < 2) {
      throw new ApiError(400, 'Need at least 2 BEEN hotels to battle')
    }

    const placeIds = beenHotels.map((h: { place_id: string }) => h.place_id)
    const sentimentMap = new Map(beenHotels.map((h: { place_id: string; sentiment: string | null }) => [h.place_id, h.sentiment]))

    // Determine active hotel (the one we're placing)
    let activeHotelId: string | null = includePlace

    // If no includePlace provided, check for unplaced hotels in placement_sessions
    if (!activeHotelId) {
      const { data: unplacedSessions } = await supabase
        .from('placement_sessions')
        .select('place_id, comparisons_done')
        .eq('user_id', userId)
        .eq('is_placed', false)
        .order('started_at', { ascending: false })
        .limit(1)

      if (unplacedSessions && unplacedSessions.length > 0) {
        activeHotelId = unplacedSessions[0].place_id
      }
    }

    // Check if active hotel is already placed (if we have one)
    let placementInfo: { comparisons_done: number; is_placed: boolean } | null = null
    if (activeHotelId && !forceComparison) {
      const { data: session } = await supabase
        .from('placement_sessions')
        .select('comparisons_done, is_placed')
        .eq('user_id', userId)
        .eq('place_id', activeHotelId)
        .single()

      if (session) {
        placementInfo = session
        // If already placed, return early - no comparison needed
        if (session.is_placed) {
          return jsonResponse({
            enabled: true,
            noComparisonNeeded: true,
            placementSession: {
              activeHotelId,
              comparisonsRemaining: 0,
              isPlaced: true,
            },
          } satisfies BattlePairResponse)
        }
      }
    }

    // Get elo ratings for these hotels
    const { data: eloRatings, error: eloError } = await supabase
      .from('elo_ratings')
      .select('place_id, rating, games_played')
      .eq('user_id', userId)
      .in('place_id', placeIds)

    if (eloError) {
      console.error('Elo ratings query error:', eloError)
      throw new ApiError(500, 'Failed to fetch elo ratings')
    }

    // Build a map of place_id -> elo data
    const eloMap = new Map<string, { rating: number; games_played: number }>()
    eloRatings?.forEach((e: { place_id: string; rating: number; games_played: number }) => {
      eloMap.set(e.place_id, { rating: e.rating, games_played: e.games_played })
    })

    // Build candidates with elo data and sentiment
    const candidates: Candidate[] = placeIds.map((place_id: string) => {
      const eloData = eloMap.get(place_id)
      return {
        place_id,
        rating: eloData?.rating || 1500,
        games_played: eloData?.games_played || 0,
        sentiment: sentimentMap.get(place_id),
      }
    })

    // Sort by rating for neighbor-based selection
    candidates.sort((a, b) => a.rating - b.rating)

    // Get recent pairs to avoid (last 30 days)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - RECENT_PAIR_DAYS)

    const { data: recentMatches } = await supabase
      .from('elo_matches')
      .select('place_a, place_b')
      .eq('user_id', userId)
      .gte('created_at', thirtyDaysAgo.toISOString())

    // Build set of recent pair keys for O(1) lookup
    const recentPairs = new Set<string>()
    recentMatches?.forEach((m: { place_a: string; place_b: string }) => {
      // Store both orderings for easy lookup
      recentPairs.add(`${m.place_a}:${m.place_b}`)
      recentPairs.add(`${m.place_b}:${m.place_a}`)
    })

    /**
     * Check if a pair was compared recently
     */
    function wasRecentlyCompared(placeA: string, placeB: string): boolean {
      return recentPairs.has(`${placeA}:${placeB}`)
    }

    /**
     * Select a pair using Beli-like smart selection:
     * 1. If activeHotelId is specified, it MUST be placeA
     * 2. Prefer partners in the same sentiment tier
     * 3. Prefer rating-neighbors (closest Elo)
     * 4. Prefer low games_played for exploration
     * 5. Occasionally pick tier "anchor" (median of tier) for quick placement
     * 6. Avoid recently compared pairs
     */
    function selectPair(): { placeA: Candidate; placeB: Candidate } | null {
      // If we have an active hotel, it must be placeA
      if (activeHotelId) {
        const activeCandidate = candidates.find(c => c.place_id === activeHotelId)
        
        if (activeCandidate) {
          const activeIdx = candidates.indexOf(activeCandidate)
          const activeTier = getSentimentTier(activeCandidate.rating)
          const activeSentiment = activeCandidate.sentiment
          
          // Build potential partners list with scoring
          const potentialPartners: Array<Candidate & { score: number }> = []
          
          for (const c of candidates) {
            if (c.place_id === activeHotelId) continue
            
            // Calculate partner score:
            // - Same sentiment tier: +10
            // - Same sentiment: +5
            // - Close Elo rating: inversely proportional to distance
            // - Low games_played: exploration bonus
            let score = 0
            
            // Tier matching (prefer same tier for local ranking)
            const partnerTier = getSentimentTier(c.rating)
            if (partnerTier === activeTier) score += 10
            if (activeSentiment && c.sentiment === activeSentiment) score += 5
            
            // Elo closeness (higher score for closer ratings)
            const eloDiff = Math.abs(c.rating - activeCandidate.rating)
            score += Math.max(0, 10 - eloDiff / 20) // Up to +10 for very close
            
            // Exploration bonus for low games_played
            score += 3 / (1 + c.games_played)
            
            // Random factor to avoid repetitive pairs
            score += Math.random() * 2
            
            potentialPartners.push({ ...c, score })
          }
          
          // Sort by score descending
          potentialPartners.sort((a, b) => b.score - a.score)
          
          // Occasionally (1 in 4 chance) pick a "tier anchor" for fast placement
          // Anchor = the median-rated item in the same sentiment tier
          const useAnchor = Math.random() < 0.25 && placementInfo && placementInfo.comparisons_done < 2
          if (useAnchor) {
            const sameTierCandidates = candidates
              .filter(c => c.place_id !== activeHotelId && getSentimentTier(c.rating) === activeTier)
              .sort((a, b) => a.rating - b.rating)
            
            if (sameTierCandidates.length > 0) {
              const medianIdx = Math.floor(sameTierCandidates.length / 2)
              const anchor = sameTierCandidates[medianIdx]
              if (!wasRecentlyCompared(activeHotelId, anchor.place_id)) {
                return {
                  placeA: activeCandidate,
                  placeB: anchor,
                }
              }
            }
          }
          
          // Find a valid partner (not recently compared)
          for (const partner of potentialPartners) {
            if (!wasRecentlyCompared(activeHotelId, partner.place_id)) {
              return {
                placeA: activeCandidate,
                placeB: partner,
              }
            }
          }
          
          // Fallback: just pick any partner if all were recently compared
          if (potentialPartners.length > 0) {
            return {
              placeA: activeCandidate,
              placeB: potentialPartners[0],
            }
          }
        }
      }
      
      // Standard selection if includePlace is not specified or not found
      // Weight candidates by exploration need (lower games_played = higher weight)
      const weightedCandidates = candidates.map((c, idx) => ({
        ...c,
        idx,
        // Exploration weight: prefer low games_played
        // Add randomness to avoid always picking same pairs
        weight: 1 / (1 + c.games_played) + Math.random() * 0.3,
      }))

      // Sort by weight (descending) to prioritize exploration
      weightedCandidates.sort((a, b) => b.weight - a.weight)

      // Take top candidates for selection
      const topCandidates = weightedCandidates.slice(0, Math.min(15, weightedCandidates.length))

      // Try to find a valid pair
      for (let retry = 0; retry < MAX_PAIR_RETRIES; retry++) {
        // Pick first candidate from weighted top
        const firstIdx = Math.floor(Math.random() * Math.min(5, topCandidates.length))
        const first = topCandidates[firstIdx]

        // For second candidate, prefer neighbors in rating (similar Elo)
        // Look within a window of ±3 positions in the rating-sorted list
        const neighborWindow = 3
        const sortedIdx = first.idx
        const neighborStart = Math.max(0, sortedIdx - neighborWindow)
        const neighborEnd = Math.min(candidates.length - 1, sortedIdx + neighborWindow)

        // Collect valid neighbors (excluding self)
        const neighbors: Candidate[] = []
        for (let i = neighborStart; i <= neighborEnd; i++) {
          if (i !== sortedIdx) {
            neighbors.push(candidates[i])
          }
        }

        // If no neighbors, fall back to any different candidate
        if (neighbors.length === 0) {
          // Find a different candidate
          for (let i = 0; i < topCandidates.length; i++) {
            if (i !== firstIdx) {
              const second = topCandidates[i]
              // CRITICAL: Ensure we never compare a hotel with itself
              if (first.place_id !== second.place_id && !wasRecentlyCompared(first.place_id, second.place_id)) {
                return {
                  placeA: first,
                  placeB: second,
                }
              }
            }
          }
          continue
        }

        // Weight neighbors by exploration need
        const weightedNeighbors = neighbors.map(n => ({
          ...n,
          weight: 1 / (1 + n.games_played) + Math.random() * 0.2,
        }))
        weightedNeighbors.sort((a, b) => b.weight - a.weight)

        // Find a valid neighbor that's different from first
        for (const second of weightedNeighbors) {
          // CRITICAL: Ensure we never compare a hotel with itself
          if (first.place_id !== second.place_id && !wasRecentlyCompared(first.place_id, second.place_id)) {
            return {
              placeA: first,
              placeB: second,
            }
          }
        }
      }

      // Fallback: just pick any two different candidates
      if (candidates.length >= 2) {
        // Ensure we pick two DIFFERENT candidates
        for (let i = 0; i < candidates.length; i++) {
          for (let j = i + 1; j < candidates.length; j++) {
            if (candidates[i].place_id !== candidates[j].place_id) {
              return {
                placeA: candidates[i],
                placeB: candidates[j],
              }
            }
          }
        }
      }

      return null
    }

    const selectedPair = selectPair()
    if (!selectedPair) {
      throw new ApiError(400, 'Could not find a valid pair for comparison')
    }

    const { placeA, placeB } = selectedPair

    // Compute tier-percentile display scores for all candidates
    const hotelsForScoring = candidates.map(c => ({
      place_id: c.place_id,
      rating: c.rating,
      sentiment: (c.sentiment || 'FINE') as SentimentTier,
    }))
    const displayScoreResults = computeDisplayScoresForHotels(hotelsForScoring)

    // Fetch place details from cache
    const { data: placesData } = await supabase
      .from('place_cache')
      .select('place_id, name, city, country, details')
      .in('place_id', [placeA.place_id, placeB.place_id])

    const placeMap = new Map(placesData?.map((p: any) => [p.place_id, p]) || [])

    // Build response with tier-percentile display scores
    const placeAData = placeMap.get(placeA.place_id)
    const placeBData = placeMap.get(placeB.place_id)
    const placeADisplayScore = getDisplayScoreFromResults(displayScoreResults, placeA.place_id) ?? 5.0
    const placeBDisplayScore = getDisplayScoreFromResults(displayScoreResults, placeB.place_id) ?? 5.0

    const result: BattlePairResponse = {
      enabled: true,
      pair: {
        placeAId: placeA.place_id,
        placeBId: placeB.place_id,
        placeA: {
          name: placeAData?.name || 'Unknown',
          city: placeAData?.city,
          country: placeAData?.country,
          photo: placeAData?.details?.photos?.[0],
          rating: placeA.rating,
          displayScore: placeADisplayScore,
          gamesPlayed: placeA.games_played,
        },
        placeB: {
          name: placeBData?.name || 'Unknown',
          city: placeBData?.city,
          country: placeBData?.country,
          photo: placeBData?.details?.photos?.[0],
          rating: placeB.rating,
          displayScore: placeBDisplayScore,
          gamesPlayed: placeB.games_played,
        },
      },
    }

    // Add placement session info if we have an active hotel
    if (activeHotelId) {
      const comparisonsRemaining = PLACEMENT_MAX_COMPARISONS - (placementInfo?.comparisons_done || 0)
      result.placementSession = {
        activeHotelId,
        comparisonsRemaining: Math.max(0, comparisonsRemaining),
        isPlaced: false,
      }
    }

    return jsonResponse(result)

  } catch (error) {
    return errorResponse(error)
  }
})
