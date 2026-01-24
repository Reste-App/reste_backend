// Shared utilities for Supabase Edge Functions
// Auth verification, Supabase clients, error handling, Elo utilities

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

// =============================================================================
// Configuration Constants
// =============================================================================

/** Minimum number of marked (BEEN) hotels required to enable comparisons */
export const MARK_THRESHOLD = 5

/** Base K-factor for Elo updates */
export const ELO_K_BASE = 24

/** Minimum K-factor (decreases as games_played increases) */
export const ELO_K_MIN = 12

/** Elo seeding values based on sentiment/mark */
export const ELO_SEED = {
  LIKED: 1550,
  FINE: 1500,
  DISLIKED: 1450,
} as const

// =============================================================================
// Placement Session Constants (Beli-like stopping behavior)
// =============================================================================

/** Maximum comparisons before forcing placement (hard UX cap) */
export const PLACEMENT_MAX_COMPARISONS = 4

/** Number of stable rank positions needed to trigger placement */
export const PLACEMENT_STABLE_THRESHOLD = 2

/** Elo rating ranges for each sentiment tier (for tier-based neighbor selection) */
export const ELO_TIER_RANGES = {
  LIKED: { min: 1525, max: 1700 },    // Center around 1550
  FINE: { min: 1475, max: 1525 },      // Center around 1500
  DISLIKED: { min: 1300, max: 1475 },  // Center around 1450
} as const

/**
 * Get the sentiment tier for a given Elo rating
 */
export function getSentimentTier(rating: number): 'LIKED' | 'FINE' | 'DISLIKED' {
  if (rating >= ELO_TIER_RANGES.LIKED.min) return 'LIKED'
  if (rating >= ELO_TIER_RANGES.FINE.min) return 'FINE'
  return 'DISLIKED'
}

// =============================================================================
// Elo Utilities
// =============================================================================

/**
 * Calculate display score (0.0 - 10.0) from Elo rating
 * Uses sigmoid function centered at 1500 with scale factor 200
 * Formula: 10 * (1 / (1 + exp(-(rating - 1500) / 200)))
 */
export function eloToDisplayScore(rating: number): number {
  const score = 10 * (1 / (1 + Math.exp(-(rating - 1500) / 200)))
  return Math.round(score * 10) / 10 // Round to 1 decimal
}

/**
 * Calculate dynamic K-factor based on games played
 * K decreases as player has more games, making ratings more stable
 * Formula: max(K_MIN, K_BASE - games_played / 10)
 */
export function dynamicKFactor(gamesPlayed: number): number {
  return Math.max(ELO_K_MIN, ELO_K_BASE - gamesPlayed / 10)
}

/**
 * Calculate expected score for player A vs player B (standard Elo formula)
 */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400))
}

/**
 * Get seed Elo rating from sentiment value
 */
export function getSeedRating(sentiment: string | null): number {
  if (sentiment === 'LIKED') return ELO_SEED.LIKED
  if (sentiment === 'DISLIKED') return ELO_SEED.DISLIKED
  return ELO_SEED.FINE
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = ReturnType<typeof createClient<any>>

export interface AuthContext {
  userId: string
  supabase: SupabaseClient
  supabaseAdmin: SupabaseClient
}

/**
 * Verify JWT token and return authenticated user ID + Supabase clients
 */
export async function verifyAuth(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ApiError(401, 'Missing or invalid Authorization header')
  }

  const token = authHeader.replace('Bearer ', '')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Client for user-scoped operations (with RLS)
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  // Admin client for service-level operations (bypasses RLS)
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

  // Verify token and get user
  const { data: { user }, error } = await supabase.auth.getUser(token)
  
  if (error || !user) {
    throw new ApiError(401, 'Invalid or expired token')
  }

  return {
    userId: user.id,
    supabase,
    supabaseAdmin,
  }
}

/**
 * Custom API error class
 */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Standard JSON response helper with CORS headers
 */
export function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  })
}

/**
 * Error response helper with CORS headers
 */
export function errorResponse(error: unknown): Response {
  console.error('Error:', error)
  
  if (error instanceof ApiError) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.status,
      headers: { 
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    })
  }
  
  if (error instanceof Error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    })
  }
  
  return new Response(JSON.stringify({ error: 'Internal server error' }), {
    status: 500,
    headers: { 
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  })
}

/**
 * CORS headers for edge functions
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Handle CORS preflight
 */
export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return null
}
