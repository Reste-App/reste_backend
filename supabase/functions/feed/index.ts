// Feed Edge Function
// GET /feed?limit=20&cursor=timestamp - Get activity feed from followed users

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'
import { verifyAuth, ApiError, jsonResponse, errorResponse, corsHeaders, handleCors } from '../_shared/utils.ts'

const FeedParamsSchema = z.object({
  limit: z.string().optional().transform(val => val ? parseInt(val, 10) : 20),
  cursor: z.string().optional(), // ISO timestamp
})

interface FeedEvent {
  id: string
  actor_id: string
  event_type: string
  payload: any
  created_at: string
}

Deno.serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    // Only allow GET
    if (req.method !== 'GET') {
      throw new ApiError(405, 'Method not allowed')
    }

    // Verify authentication
    const { userId, supabase } = await verifyAuth(req)

    // Parse query params
    const url = new URL(req.url)
    const params = FeedParamsSchema.parse({
      limit: url.searchParams.get('limit'),
      cursor: url.searchParams.get('cursor'),
    })

    // Get list of users the requester follows
    const { data: following, error: followError } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', userId)

    if (followError) {
      console.error('Follow query error:', followError)
      throw new ApiError(500, 'Failed to fetch following list')
    }

    const followingIds = following?.map(f => f.following_id) || []

    // If not following anyone, return empty feed
    if (followingIds.length === 0) {
      return jsonResponse({
        events: [],
        next_cursor: null,
      })
    }

    // Build query for feed events
    let query = supabase
      .from('feed_events')
      .select('*')
      .in('actor_id', followingIds)
      .order('created_at', { ascending: false })
      .limit(params.limit)

    // Apply cursor for pagination
    if (params.cursor) {
      query = query.lt('created_at', params.cursor)
    }

    const { data: events, error: eventsError } = await query

    if (eventsError) {
      console.error('Events query error:', eventsError)
      throw new ApiError(500, 'Failed to fetch feed events')
    }

    // Determine next cursor
    let nextCursor: string | null = null
    if (events && events.length === params.limit) {
      nextCursor = events[events.length - 1].created_at
    }

    return jsonResponse({
      events: events || [],
      next_cursor: nextCursor,
    })

  } catch (error) {
    return errorResponse(error)
  }
})
