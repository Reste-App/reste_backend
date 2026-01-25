// Recalculate Display Scores Edge Function
// POST /recalculate-scores - Recalculate display scores for the current user's hotels

import { 
  verifyAuth, 
  jsonResponse, 
  errorResponse, 
  handleCors,
  updateStoredDisplayScores,
} from '../_shared/utils.ts'

Deno.serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    // Only allow POST
    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405)
    }

    // Verify authentication
    const { userId, supabaseAdmin } = await verifyAuth(req)

    // Recalculate and update display scores for this user
    const updatedCount = await updateStoredDisplayScores(supabaseAdmin, userId)

    return jsonResponse({
      success: true,
      updatedCount,
      message: `Updated display scores for ${updatedCount} hotels`,
    })

  } catch (error) {
    return errorResponse(error)
  }
})
