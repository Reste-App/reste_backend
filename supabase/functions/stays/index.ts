// Stays Management Edge Function
// PUT /stays/:place_id - Add/update hotel to user's list with status and sentiment

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'
import { verifyAuth, ApiError, jsonResponse, errorResponse, corsHeaders, handleCors } from '../_shared/utils.ts'

const StayBodySchema = z.object({
  status: z.enum(['WANT', 'BEEN']),
  sentiment: z.enum(['LIKED', 'FINE', 'DISLIKED']).optional().nullable(),
  stayed_at: z.string().optional().nullable(), // ISO timestamp
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
    // Only allow PUT
    if (req.method !== 'PUT') {
      throw new ApiError(405, 'Method not allowed')
    }

    // Verify authentication
    const { userId, supabase, supabaseAdmin } = await verifyAuth(req)

    // Extract place_id from URL path
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const placeId = pathParts[pathParts.length - 1]
    
    if (!placeId) {
      throw new ApiError(400, 'place_id is required in URL path')
    }

    // Parse and validate body
    const body = await req.json()
    const data = StayBodySchema.parse(body)

    // Upsert stay
    const { data: stay, error: stayError } = await supabase
      .from('stays')
      .upsert({
        user_id: userId,
        place_id: placeId,
        status: data.status,
        sentiment: data.sentiment || null,
        stayed_at: data.stayed_at || null,
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

    // If status is BEEN, ensure elo_ratings row exists
    if (data.status === 'BEEN') {
      const { error: eloError } = await supabase
        .from('elo_ratings')
        .upsert({
          user_id: userId,
          place_id: placeId,
          rating: 1500,
          games_played: 0,
        }, { 
          onConflict: 'user_id,place_id',
          ignoreDuplicates: true, // Don't overwrite existing ratings
        })

      if (eloError) {
        console.error('Elo rating init error:', eloError)
        // Non-fatal, continue
      }
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
    })

  } catch (error) {
    return errorResponse(error)
  }
})
