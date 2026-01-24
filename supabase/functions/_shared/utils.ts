// Shared utilities for Supabase Edge Functions
// Auth verification, Supabase clients, error handling

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

export interface AuthContext {
  userId: string
  supabase: ReturnType<typeof createClient>
  supabaseAdmin: ReturnType<typeof createClient>
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
 * Standard JSON response helper
 */
export function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Error response helper
 */
export function errorResponse(error: unknown): Response {
  console.error('Error:', error)
  
  if (error instanceof ApiError) {
    return jsonResponse({ error: error.message }, error.status)
  }
  
  if (error instanceof Error) {
    return jsonResponse({ error: error.message }, 500)
  }
  
  return jsonResponse({ error: 'Internal server error' }, 500)
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
