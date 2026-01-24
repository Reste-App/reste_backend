// Places Search Edge Function
// Proxy for Google Places Text/Nearby Search + basic caching

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'
import { verifyAuth, ApiError, jsonResponse, errorResponse, corsHeaders, handleCors } from '../_shared/utils.ts'

const SearchParamsSchema = z.object({
  query: z.string().optional(),
  location: z.string().optional(), // "lat,lng"
  radius: z.string().optional().transform(val => val ? parseInt(val, 10) : 5000),
  type: z.string().default('lodging'),
})

interface PlaceSearchResult {
  place_id: string
  name: string
  address: string
  rating?: number
  user_ratings_total?: number
  photo_reference?: string
  lat?: number
  lng?: number
}

Deno.serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    // Verify authentication
    const { supabaseAdmin } = await verifyAuth(req)

    // Parse and validate query params
    const url = new URL(req.url)
    const params = SearchParamsSchema.parse({
      query: url.searchParams.get('query'),
      location: url.searchParams.get('location'),
      radius: url.searchParams.get('radius'),
      type: url.searchParams.get('type'),
    })

    // Get Google API key
    const googleApiKey = Deno.env.get('GOOGLE_PLACES_API_KEY')
    if (!googleApiKey) {
      throw new ApiError(500, 'Google Places API key not configured')
    }

    // Build Google Places API request
    let placesUrl: string
    
    if (params.query) {
      // Text Search
      placesUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(params.query)}&type=${params.type}&key=${googleApiKey}`
      if (params.location) {
        placesUrl += `&location=${params.location}&radius=${params.radius}`
      }
    } else if (params.location) {
      // Nearby Search
      placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${params.location}&radius=${params.radius}&type=${params.type}&key=${googleApiKey}`
    } else {
      throw new ApiError(400, 'Either query or location parameter is required')
    }

    // Call Google Places API
    const placesResponse = await fetch(placesUrl)
    const placesData = await placesResponse.json()

    if (placesData.status !== 'OK' && placesData.status !== 'ZERO_RESULTS') {
      console.error('Google Places API error:', placesData)
      throw new ApiError(500, `Google Places API error: ${placesData.status}`)
    }

    // Transform results
    const results: PlaceSearchResult[] = (placesData.results || []).map((place: any) => ({
      place_id: place.place_id,
      name: place.name,
      address: place.vicinity || place.formatted_address || '',
      rating: place.rating,
      user_ratings_total: place.user_ratings_total,
      photo_reference: place.photos?.[0]?.photo_reference,
      lat: place.geometry?.location?.lat,
      lng: place.geometry?.location?.lng,
    }))

    // Optionally cache basic info for each place
    for (const result of results) {
      await supabaseAdmin
        .from('place_cache')
        .upsert({
          place_id: result.place_id,
          name: result.name,
          details: { 
            name: result.name,
            address: result.address,
            rating: result.rating,
            user_ratings_total: result.user_ratings_total,
            lat: result.lat,
            lng: result.lng,
          },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'place_id', ignoreDuplicates: true })
    }

    return jsonResponse({
      results,
      status: placesData.status,
    })

  } catch (error) {
    return errorResponse(error)
  }
})
