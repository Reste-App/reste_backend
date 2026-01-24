// Posts Edge Function
// POST /posts - Create a new post/review for a hotel

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'
import { verifyAuth, ApiError, jsonResponse, errorResponse, corsHeaders, handleCors } from '../_shared/utils.ts'

const CreatePostSchema = z.object({
  place_id: z.string().min(1),
  text: z.string().min(1).max(2000),
  tags: z.array(z.string()).optional(),
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
    const data = CreatePostSchema.parse(body)

    // Create post
    const { data: post, error: postError } = await supabase
      .from('posts')
      .insert({
        user_id: userId,
        place_id: data.place_id,
        text: data.text.trim(),
        tags: data.tags || null,
      })
      .select()
      .single()

    if (postError) {
      console.error('Post creation error:', postError)
      throw new ApiError(400, `Failed to create post: ${postError.message}`)
    }

    // Get user profile and place details for feed event
    const { data: profile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', userId)
      .single()

    const { data: placeCache } = await supabase
      .from('place_cache')
      .select('name, city, country')
      .eq('place_id', data.place_id)
      .single()

    // Create feed event
    const { error: feedError } = await supabaseAdmin
      .from('feed_events')
      .insert({
        actor_id: userId,
        event_type: 'POST',
        payload: {
          post_id: post.id,
          place_id: data.place_id,
          place_name: placeCache?.name || 'Unknown',
          city: placeCache?.city,
          country: placeCache?.country,
          username: profile?.username || 'unknown',
          text_preview: data.text.slice(0, 100),
          tags: data.tags,
        },
      })

    if (feedError) {
      console.error('Feed event error:', feedError)
      // Non-fatal
    }

    return jsonResponse({
      success: true,
      post,
    }, 201)

  } catch (error) {
    return errorResponse(error)
  }
})
