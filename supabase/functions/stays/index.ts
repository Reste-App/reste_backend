import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'
import {
  verifyAuth,
  ApiError,
  jsonResponse,
  errorResponse,
  handleCors,
} from '../_shared/utils.ts'

const StayBodySchema = z.object({
  place_id: z.string().min(1),
  status: z.enum(['WANT', 'BEEN']),
  sentiment: z.enum(['LIKED', 'FINE', 'DISLIKED']).optional().nullable(),
  stayed_at: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  photos: z.array(z.string()).optional().nullable(),
}).refine(
  (data) => {
    if (data.status === 'BEEN' && !data.sentiment) return false
    if (data.status === 'WANT' && data.sentiment) return false
    return true
  },
  { message: 'Sentiment required for BEEN status, must be null for WANT status' },
)

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    if (req.method !== 'POST' && req.method !== 'PUT') {
      throw new ApiError(405, 'Method not allowed')
    }

    const { userId, supabase, supabaseAdmin } = await verifyAuth(req)

    let body: any
    try {
      body = await req.json()
    } catch {
      throw new ApiError(400, 'Invalid JSON body')
    }

    let data: z.infer<typeof StayBodySchema>
    try {
      data = StayBodySchema.parse(body)
    } catch (zodErr) {
      if (zodErr instanceof z.ZodError) {
        const issues = zodErr.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
        throw new ApiError(400, `Validation failed: ${issues}`)
      }
      throw new ApiError(400, 'Validation failed')
    }

    const placeId = data.place_id

    // If changing sentiment on an already-ranked BEEN hotel, unrank it first
    // so it can be re-placed in the new tier.
    if (data.status === 'BEEN') {
      const { data: existing } = await supabase
        .from('stays')
        .select('sentiment, rank_in_tier')
        .eq('user_id', userId)
        .eq('place_id', placeId)
        .single()

      if (
        existing &&
        existing.rank_in_tier !== null &&
        existing.sentiment !== data.sentiment
      ) {
        await supabaseAdmin.rpc('rank_reset_placement', {
          p_user_id: userId,
          p_place_id: placeId,
          p_sentiment: existing.sentiment,
          p_old_rank: existing.rank_in_tier,
        })
      }
    }

    const { data: stay, error: stayError } = await supabase
      .from('stays')
      .upsert(
        {
          user_id: userId,
          place_id: placeId,
          status: data.status,
          sentiment: data.sentiment || null,
          stayed_at: data.stayed_at || null,
          notes: data.notes || null,
          photos: data.photos || [],
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,place_id', ignoreDuplicates: false },
      )
      .select()
      .single()

    if (stayError) {
      console.error('Stay upsert error:', stayError)
      throw new ApiError(400, `Failed to upsert stay: ${stayError.message}`)
    }

    // Feed event
    const { data: profile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', userId)
      .single()

    const { data: placeCache } = await supabase
      .from('place_cache')
      .select('name, city, country')
      .eq('place_id', placeId)
      .single()

    const eventType = data.status === 'BEEN' ? 'MARK_BEEN' : 'WISHLIST'
    await supabaseAdmin.from('feed_events').insert({
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

    return jsonResponse({ success: true, stay })
  } catch (error) {
    return errorResponse(error)
  }
})
