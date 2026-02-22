import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

// =============================================================================
// Display Score Bands
// =============================================================================

export const DISPLAY_SCORE_BANDS = {
  LIKED: { min: 6.7, max: 10.0 },
  FINE: { min: 3.4, max: 6.7 },
  DISLIKED: { min: 0.0, max: 3.4 },
} as const

export type SentimentTier = 'LIKED' | 'FINE' | 'DISLIKED'

/**
 * Compute display score from rank position within a sentiment tier.
 *
 * rank_in_tier is 0-indexed (0 = lowest, n-1 = highest).
 * Single hotel in a tier gets the band midpoint.
 */
export function computeDisplayScore(
  rankInTier: number,
  totalInTier: number,
  sentiment: SentimentTier,
): number {
  const band = DISPLAY_SCORE_BANDS[sentiment]
  const n = Math.max(1, totalInTier)
  const percentile = n <= 1 ? 0.5 : rankInTier / (n - 1)
  const score = band.min + percentile * (band.max - band.min)
  return Math.round(Math.max(0, Math.min(10, score)) * 10) / 10
}

// =============================================================================
// Auth
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = ReturnType<typeof createClient<any>>

export interface AuthContext {
  userId: string
  supabase: SupabaseClient
  supabaseAdmin: SupabaseClient
}

export async function verifyAuth(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ApiError(401, 'Missing or invalid Authorization header')
  }

  const token = authHeader.replace('Bearer ', '')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

  const { data: { user }, error } = await supabase.auth.getUser(token)

  if (error || !user) {
    throw new ApiError(401, 'Invalid or expired token')
  }

  return { userId: user.id, supabase, supabaseAdmin }
}

// =============================================================================
// Response helpers
// =============================================================================

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  })
}

export function errorResponse(error: unknown): Response {
  console.error('Error:', error)

  if (error instanceof ApiError) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }

  const message = error instanceof Error ? error.message : 'Internal server error'
  return new Response(JSON.stringify({ error: message }), {
    status: 500,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return null
}
