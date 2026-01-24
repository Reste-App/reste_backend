// Follow Edge Function
// POST /follow/:userId - Follow a user
// DELETE /follow/:userId - Unfollow a user

import { verifyAuth, ApiError, jsonResponse, errorResponse, corsHeaders, handleCors } from '../_shared/utils.ts'

Deno.serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    // Only allow POST and DELETE
    if (req.method !== 'POST' && req.method !== 'DELETE') {
      throw new ApiError(405, 'Method not allowed')
    }

    // Verify authentication
    const { userId, supabase, supabaseAdmin } = await verifyAuth(req)

    // Extract target user ID from URL path
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const targetUserId = pathParts[pathParts.length - 1]
    
    if (!targetUserId) {
      throw new ApiError(400, 'Target user ID is required in URL path')
    }

    // Validate target user exists
    const { data: targetUser, error: userError } = await supabase
      .from('profiles')
      .select('id, username')
      .eq('id', targetUserId)
      .single()

    if (userError || !targetUser) {
      throw new ApiError(404, 'Target user not found')
    }

    // Prevent self-follow
    if (targetUserId === userId) {
      throw new ApiError(400, 'Cannot follow yourself')
    }

    if (req.method === 'POST') {
      // Follow
      const { error: followError } = await supabase
        .from('follows')
        .insert({
          follower_id: userId,
          following_id: targetUserId,
        })

      if (followError) {
        // Check if already following (duplicate key error)
        if (followError.code === '23505') {
          throw new ApiError(400, 'Already following this user')
        }
        console.error('Follow error:', followError)
        throw new ApiError(400, `Failed to follow user: ${followError.message}`)
      }

      // Get follower profile
      const { data: followerProfile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', userId)
        .single()

      // Create feed event
      const { error: feedError } = await supabaseAdmin
        .from('feed_events')
        .insert({
          actor_id: userId,
          event_type: 'FOLLOW',
          payload: {
            follower_id: userId,
            follower_username: followerProfile?.username || 'unknown',
            following_id: targetUserId,
            following_username: targetUser.username,
          },
        })

      if (feedError) {
        console.error('Feed event error:', feedError)
        // Non-fatal
      }

      return jsonResponse({
        success: true,
        action: 'followed',
        target_user: targetUser.username,
      }, 201)

    } else {
      // Unfollow (DELETE)
      const { error: unfollowError } = await supabase
        .from('follows')
        .delete()
        .eq('follower_id', userId)
        .eq('following_id', targetUserId)

      if (unfollowError) {
        console.error('Unfollow error:', unfollowError)
        throw new ApiError(400, `Failed to unfollow user: ${unfollowError.message}`)
      }

      return jsonResponse({
        success: true,
        action: 'unfollowed',
        target_user: targetUser.username,
      })
    }

  } catch (error) {
    return errorResponse(error)
  }
})
