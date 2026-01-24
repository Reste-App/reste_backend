// Vibe Submit Edge Function
// POST /vibe-submit - Submit user vibe check responses for a hotel

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'
import { 
  verifyAuth, 
  ApiError, 
  jsonResponse, 
  errorResponse, 
  corsHeaders, 
  handleCors,
} from '../_shared/utils.ts'

// Schema for a single vibe response
const VibeResponseSchema = z.object({
  text: z.string().min(1).max(500),
  inputMethod: z.enum(['voice', 'text']),
})

// Schema for the request body
const VibeSubmitBodySchema = z.object({
  place_id: z.string().min(1),
  rating: z.enum(['good', 'fine', 'bad']),
  responses: z.record(
    z.enum(['vibe', 'bedding', 'view', 'cleanliness']),
    VibeResponseSchema
  ),
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
    const data = VibeSubmitBodySchema.parse(body)
    const placeId = data.place_id
    const rating = data.rating

    // Insert each response
    const insertedResponses: Array<{ category: string; success: boolean }> = []
    
    for (const [categoryId, response] of Object.entries(data.responses)) {
      const { error } = await supabase
        .from('vibe_responses')
        .insert({
          user_id: userId,
          place_id: placeId,
          category_id: categoryId,
          sentiment: rating,
          response_text: response.text,
          input_method: response.inputMethod,
        })

      insertedResponses.push({
        category: categoryId,
        success: !error,
      })

      if (error) {
        console.error(`Failed to insert response for ${categoryId}:`, error)
      }
    }

    // Invalidate cached summary for this place (mark as expired)
    await supabaseAdmin
      .from('vibe_summaries')
      .update({ expires_at: new Date().toISOString() })
      .eq('place_id', placeId)

    // Count total responses for this place
    const { count } = await supabase
      .from('vibe_responses')
      .select('*', { count: 'exact', head: true })
      .eq('place_id', placeId)

    return jsonResponse({
      success: true,
      responses: insertedResponses,
      totalResponsesForPlace: count || 0,
    })

  } catch (error) {
    return errorResponse(error)
  }
})
