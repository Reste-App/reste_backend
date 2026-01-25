// Stays Management Edge Function
// PUT /stays/:place_id - Add/update hotel to user's list with status and sentiment

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'
import { 
  verifyAuth, 
  ApiError, 
  jsonResponse, 
  errorResponse, 
  corsHeaders, 
  handleCors, 
  getSeedRating, 
  updateStoredDisplayScores,
} from '../_shared/utils.ts'

const StayBodySchema = z.object({
  place_id: z.string().min(1),
  status: z.enum(['WANT', 'BEEN']),
  sentiment: z.enum(['LIKED', 'FINE', 'DISLIKED']).optional().nullable(),
  stayed_at: z.string().optional().nullable(), // ISO timestamp
  notes: z.string().optional().nullable(), // User notes about the stay
  photos: z.array(z.string()).optional().nullable(), // Array of photo URLs
}).refine(
  (data) => {
    // If status is BEEN, sentiment is required
    if (data.status === 'BEEN' && !data.sentiment) {
      return false
    }
    // If status is WANT, sentiment must be null/undefined
    if (data.status === 'WANT' && data.sentiment) {
      return false
    }
    return true
  },
  {
    message: 'Sentiment required for BEEN status, must be null for WANT status',
  }
)

Deno.serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    // Only allow POST (for upsert) or PUT (legacy)
    if (req.method !== 'POST' && req.method !== 'PUT') {
      throw new ApiError(405, 'Method not allowed')
    }

    // Verify authentication
    const { userId, supabase, supabaseAdmin } = await verifyAuth(req)

    // Parse and validate body (place_id now comes from body)
    let body: any;
    try {
      body = await req.json()
    } catch (parseErr) {
      console.error('stays: Failed to parse request body:', parseErr)
      throw new ApiError(400, 'Invalid JSON body')
    }
    
    console.log('stays: Received body:', JSON.stringify(body, null, 2))
    
    let data: z.infer<typeof StayBodySchema>;
    try {
      data = StayBodySchema.parse(body)
    } catch (zodErr) {
      console.error('stays: Validation error:', zodErr)
      if (zodErr instanceof z.ZodError) {
        const issues = zodErr.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
        throw new ApiError(400, `Validation failed: ${issues}`)
      }
      throw new ApiError(400, 'Validation failed')
    }
    const placeId = data.place_id

    // Upsert stay
    const { data: stay, error: stayError } = await supabase
      .from('stays')
      .upsert({
        user_id: userId,
        place_id: placeId,
        status: data.status,
        sentiment: data.sentiment || null,
        stayed_at: data.stayed_at || null,
        notes: data.notes || null,
        photos: data.photos || [],
        updated_at: new Date().toISOString(),
      }, { 
        onConflict: 'user_id,place_id',
        ignoreDuplicates: false,
      })
      .select()
      .single()

    if (stayError) {
      console.error('Stay upsert error:', stayError)
      throw new ApiError(400, `Failed to upsert stay: ${stayError.message}`)
    }

    // If status is BEEN, ensure elo_ratings row exists with sentiment-seeded rating
    let eloRating: number | null = null
    let displayScore: number | null = null
    let isNewHotel = false
    
    if (data.status === 'BEEN') {
      // Check if elo_ratings row already exists
      const { data: existingRating } = await supabase
        .from('elo_ratings')
        .select('rating, games_played')
        .eq('user_id', userId)
        .eq('place_id', placeId)
        .single()
      
      if (existingRating) {
        // Rating exists - don't overwrite Elo, just update sentiment via stay
        console.log('stays: Found existing elo_rating for', placeId, 'rating:', existingRating.rating)
        eloRating = existingRating.rating
      } else {
        // New rating - seed based on sentiment
        isNewHotel = true
        const seedRating = getSeedRating(data.sentiment || null)
        console.log('stays: Creating new elo_rating for', placeId, 'with seed rating:', seedRating)
        
        // Use supabaseAdmin to bypass RLS for insert
        const { data: newRating, error: eloError } = await supabaseAdmin
          .from('elo_ratings')
          .insert({
            user_id: userId,
            place_id: placeId,
            rating: seedRating,
            games_played: 0,
          })
          .select('rating')
          .single()

        if (eloError) {
          console.error('stays: Elo rating insert FAILED:', eloError.message, eloError.details, eloError.hint)
          // Non-fatal, continue
        } else {
          console.log('stays: Elo rating inserted successfully, rating:', newRating?.rating)
          eloRating = newRating?.rating ?? seedRating
        }

        // Create placement session for the new hotel (Beli-like stopping behavior)
        const { error: sessionError } = await supabaseAdmin
          .from('placement_sessions')
          .upsert({
            user_id: userId,
            place_id: placeId,
            comparisons_done: 0,
            last_rank_position: null,
            stable_steps: 0,
            is_placed: false,
            started_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'user_id,place_id',
            ignoreDuplicates: false,
          })

        if (sessionError) {
          console.error('Placement session init error:', sessionError)
          // Non-fatal, continue
        }
      }

      // Update stored display scores for all user's hotels (tier-percentile based)
      // This ensures scores are cached in DB for efficient reads
      console.log('stays: Calling updateStoredDisplayScores for user', userId)
      const updatedScoresCount = await updateStoredDisplayScores(supabaseAdmin, userId)
      console.log('stays: Updated', updatedScoresCount, 'display scores')

      // Fetch the computed display score for this hotel
      const { data: updatedRating, error: fetchError } = await supabase
        .from('elo_ratings')
        .select('display_score')
        .eq('user_id', userId)
        .eq('place_id', placeId)
        .single()

      console.log('stays: Fetched display_score for', placeId, ':', updatedRating?.display_score, 'error:', fetchError?.message)
      displayScore = updatedRating?.display_score ?? 5.0
    }

    // Get user profile for feed event
    const { data: profile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', userId)
      .single()

    // Get place details for feed event
    const { data: placeCache } = await supabase
      .from('place_cache')
      .select('name, city, country')
      .eq('place_id', placeId)
      .single()

    // Create feed event (use admin client to bypass RLS)
    const eventType = data.status === 'BEEN' ? 'MARK_BEEN' : 'WISHLIST'
    const { error: feedError } = await supabaseAdmin
      .from('feed_events')
      .insert({
        actor_id: userId,
        event_type: eventType,
        payload: {
          place_id: placeId,
          place_name: placeCache?.name || 'Unknown',
          city: placeCache?.city,
          country: placeCache?.country,
          username: profile?.username || 'unknown',
          sentiment: data.sentiment,
        },
      })

    if (feedError) {
      console.error('Feed event error:', feedError)
      // Non-fatal, continue
    }

    return jsonResponse({
      success: true,
      stay,
      elo: eloRating ? {
        rating: eloRating,
        displayScore,
      } : null,
      // Indicates whether this is a newly added hotel (needs placement comparisons)
      isNewHotel,
    })

  } catch (error) {
    return errorResponse(error)
  }
})
