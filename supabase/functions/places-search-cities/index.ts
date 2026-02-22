// City Search Edge Function
// Proxy for Google Places Autocomplete API filtered for cities/localities

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { verifyAuth } from '../_shared/utils.ts'

const CitySearchParamsSchema = z.object({
  input: z.string().min(1),
})

interface CitySearchResult {
  place_id: string
  name: string
  country: string
  formatted_address: string
  latitude: number
  longitude: number
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

/**
 * Extract country name from address components
 */
function extractCountry(addressComponents: any[]): string {
  const countryComponent = addressComponents.find((comp: any) =>
    comp.types.includes('country')
  )
  return countryComponent?.longText || ''
}

Deno.serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    await verifyAuth(req)

    // Get environment variables for Supabase admin
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Create admin client
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Parse and validate query params
    const url = new URL(req.url)
    const params = CitySearchParamsSchema.parse({
      input: url.searchParams.get('input'),
    })

    // Get Google API key
    const googleApiKey = Deno.env.get('GOOGLE_PLACES_API_KEY')
    if (!googleApiKey) {
      throw new ApiError(500, 'Google Places API key not configured')
    }

    // Build request body for Autocomplete API - filter for cities
    const requestBody: any = {
      input: params.input,
      includedPrimaryTypes: ['locality'], // Restrict to cities/localities only
    }

    // Call Google Places Autocomplete API
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

    // Transform results and fetch coordinates for each city
    const results: CitySearchResult[] = []

    for (const suggestion of data.suggestions || []) {
      const prediction = suggestion.placePrediction
      if (!prediction) continue

      // Get place details to fetch coordinates
      const placeId = prediction.placeId
      const detailsUrl = `https://places.googleapis.com/v1/places/${placeId}?fields=location,formattedAddress,addressComponents&key=${googleApiKey}`

      const detailsResponse = await fetch(detailsUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const detailsData = await detailsResponse.json()

      if (detailsData.error) {
        console.error('Error fetching place details:', detailsData.error)
        continue
      }

      const country = extractCountry(detailsData.addressComponents || [])

      results.push({
        place_id: placeId,
        name: prediction.structuredFormat?.mainText?.text || prediction.text?.text || '',
        country: country,
        formatted_address: detailsData.formattedAddress || prediction.structuredFormat?.secondaryText?.text || '',
        latitude: detailsData.location?.latitude || 0,
        longitude: detailsData.location?.longitude || 0,
      })
    }

    return jsonResponse({
      results,
      status: 'OK',
    })

  } catch (error) {
    return errorResponse(error)
  }
})
