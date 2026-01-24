// Places Autocomplete Edge Function
// Proxy for Google Places Autocomplete (New) API + basic caching

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const AutocompleteParamsSchema = z.object({
  input: z.string().min(1),
  location: z.string().nullable().optional(), // "lat,lng" or null/undefined
  radius: z.number().optional().default(5000), // meters
  includedRegionCodes: z.string().nullable().optional(), // comma-separated country codes or null/undefined
})

interface PlaceAutocompleteResult {
  place_id: string
  name: string
  address: string
  types: string[]
}

/**
 * Custom API error class
 */
class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Standard JSON response helper
 */
function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

/**
 * Error response helper
 */
function errorResponse(error: unknown): Response {
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
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Handle CORS preflight
 */
function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return null
}

Deno.serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    // Get environment variables for Supabase admin
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Create admin client (bypasses RLS for caching)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Note: Authentication is optional for this function during testing
    // In production, you should verify the user's JWT token here

    // Parse and validate query params
    const url = new URL(req.url)
    const params = AutocompleteParamsSchema.parse({
      input: url.searchParams.get('input'),
      location: url.searchParams.get('location') || undefined,
      radius: url.searchParams.get('radius') ? parseInt(url.searchParams.get('radius')!) : undefined,
      includedRegionCodes: url.searchParams.get('includedRegionCodes') || undefined,
    })

    // Get Google API key
    const googleApiKey = Deno.env.get('GOOGLE_PLACES_API_KEY')
    if (!googleApiKey) {
      throw new ApiError(500, 'Google Places API key not configured')
    }

    // Build request body for Autocomplete (New) API
    const requestBody: any = {
      input: params.input,
      includedPrimaryTypes: ['lodging'], // Restrict to hotels/lodging only
    }

    // Add location bias if provided
    if (params.location) {
      const [lat, lng] = params.location.split(',').map(v => parseFloat(v.trim()))
      if (!isNaN(lat) && !isNaN(lng)) {
        requestBody.locationBias = {
          circle: {
            center: {
              latitude: lat,
              longitude: lng,
            },
            radius: params.radius,
          },
        }
      }
    }

    // Add region codes if provided
    if (params.includedRegionCodes) {
      requestBody.includedRegionCodes = params.includedRegionCodes.split(',').map(c => c.trim())
    }

    // Call Google Places Autocomplete (New) API
    const autocompleteUrl = `https://places.googleapis.com/v1/places:autocomplete?key=${googleApiKey}`
    const response = await fetch(autocompleteUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    const data = await response.json()

    if (data.error && response.status !== 200) {
      console.error('Google Places Autocomplete API error:', data.error)
      throw new ApiError(500, `Google Places API error: ${data.error.message || data.error.status}`)
    }

    // Transform results
    const results: PlaceAutocompleteResult[] = (data.suggestions || [])
      .filter((suggestion: any) => suggestion.placePrediction)
      .map((suggestion: any) => {
        const prediction = suggestion.placePrediction
        return {
          place_id: prediction.placeId,
          name: prediction.structuredFormat?.mainText?.text || prediction.text?.text || '',
          address: prediction.structuredFormat?.secondaryText?.text || '',
          types: prediction.types || [],
        }
      })

    // Optionally cache basic info for each place (details NOT NULL — use minimal stub)
    for (const result of results) {
      await supabaseAdmin
        .from('place_cache')
        .upsert({
          place_id: result.place_id,
          name: result.name,
          details: { place_id: result.place_id, name: result.name, address: result.address },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'place_id', ignoreDuplicates: true })
    }

    return jsonResponse({
      results,
      status: response.status === 200 ? 'OK' : 'ERROR',
    })

  } catch (error) {
    return errorResponse(error)
  }
})
