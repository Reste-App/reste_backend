// Profile Edge Function
// GET /profile/:userId - Get user profile and stats
// PATCH /profile - Update own profile

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'
import { verifyAuth, ApiError, jsonResponse, errorResponse, corsHeaders, handleCors } from '../_shared/utils.ts'

const UpdateProfileSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/).optional(),
  avatar_url: z.string().url().optional().nullable(),
})

Deno.serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    // Verify authentication
    const { userId, supabase } = await verifyAuth(req)

    if (req.method === 'GET') {
      // Get profile
      const url = new URL(req.url)
      const pathParts = url.pathname.split('/')
      const targetUserId = pathParts[pathParts.length - 1]
      
      if (!targetUserId || targetUserId === 'profile') {
        throw new ApiError(400, 'User ID required in URL path')
      }

      // Get profile
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, username, avatar_url, created_at')
        .eq('id', targetUserId)
        .single()

      if (profileError || !profile) {
        throw new ApiError(404, 'User not found')
      }

      // Get stats
      const { count: beenCount } = await supabase
        .from('stays')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', targetUserId)
        .eq('status', 'BEEN')

      const { count: wantCount } = await supabase
        .from('stays')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', targetUserId)
        .eq('status', 'WANT')

      const { count: followersCount } = await supabase
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('following_id', targetUserId)

      const { count: followingCount } = await supabase
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('follower_id', targetUserId)

      // Check if current user follows this profile
      let isFollowing = false
      if (targetUserId !== userId) {
        const { data: followData } = await supabase
          .from('follows')
          .select('*')
          .eq('follower_id', userId)
          .eq('following_id', targetUserId)
          .single()
        
        isFollowing = !!followData
      }

      return jsonResponse({
        profile: {
          ...profile,
          stats: {
            been_count: beenCount || 0,
            want_count: wantCount || 0,
            followers_count: followersCount || 0,
            following_count: followingCount || 0,
          },
          is_following: isFollowing,
          is_own_profile: targetUserId === userId,
        },
      })

    } else if (req.method === 'PATCH') {
      // Update own profile
      const body = await req.json()
      const data = UpdateProfileSchema.parse(body)

      const updateData: any = {}
      if (data.username !== undefined) updateData.username = data.username
      if (data.avatar_url !== undefined) updateData.avatar_url = data.avatar_url

      if (Object.keys(updateData).length === 0) {
        throw new ApiError(400, 'No fields to update')
      }

      const { data: updatedProfile, error: updateError } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', userId)
        .select()
        .single()

      if (updateError) {
        // Check for duplicate username
        if (updateError.code === '23505') {
          throw new ApiError(400, 'Username already taken')
        }
        console.error('Profile update error:', updateError)
        throw new ApiError(400, `Failed to update profile: ${updateError.message}`)
      }

      return jsonResponse({
        success: true,
        profile: updatedProfile,
      })

    } else {
      throw new ApiError(405, 'Method not allowed')
    }

  } catch (error) {
    return errorResponse(error)
  }
})
