// Places Details Edge Function
// Proxy for Google Places Details (New) API with 7-day caching

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'
import { verifyAuth, ApiError, jsonResponse, errorResponse, corsHeaders, handleCors } from '../_shared/utils.ts'

const DetailsParamsSchema = z.object({
  place_id: z.string().min(1),
})

const CACHE_TTL_DAYS = 7

interface PlaceDetails {
  place_id: string
  name: string
  address: string
  formatted_address?: string
  phone?: string
  website?: string
  rating?: number
  user_rating_count?: number
  price_level?: number
  photos?: string[]
  reviews?: any[]
  opening_hours?: any
  lat?: number
  lng?: number
  types?: string[]
  chain?: string
  city?: string
  country?: string
}

Deno.serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    // Get environment variables for Supabase admin
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.39.0')

    // Create admin client (bypasses RLS for caching)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Note: Authentication is optional for this function during testing
    // In production, you should verify the user's JWT token here

    // Parse and validate query params
    const url = new URL(req.url)
    const params = DetailsParamsSchema.parse({
      place_id: url.searchParams.get('place_id'),
    })

    // Check cache first
    const { data: cached, error: cacheError } = await supabaseAdmin
      .from('place_cache')
      .select('*')
      .eq('place_id', params.place_id)
      .single()

    if (!cacheError && cached && cached.details) {
      const updatedAt = new Date(cached.updated_at)
      const now = new Date()
      const daysSinceUpdate = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24)

      if (daysSinceUpdate < CACHE_TTL_DAYS) {
        console.log(`Cache hit for place_id: ${params.place_id}`)
        return jsonResponse({
          ...cached.details,
          place_id: cached.place_id,
          cached: true,
        })
      }
    }

    // Cache miss or expired - fetch from Google
    console.log(`Cache miss for place_id: ${params.place_id}, fetching from Google`)

    const googleApiKey = Deno.env.get('GOOGLE_PLACES_API_KEY')
    if (!googleApiKey) {
      throw new ApiError(500, 'Google Places API key not configured')
    }

    // Define the fields we want from Place Details (New) API
    // This maps to the "Enterprise" pricing tier which includes reviews, rating, etc.
    const fieldMask = [
      'id',
      'displayName',
      'formattedAddress',
      'nationalPhoneNumber',
      'internationalPhoneNumber',
      'websiteUri',
      'rating',
      'userRatingCount',
      'priceLevel',
      'photos',
      'reviews',
      'currentOpeningHours',
      'regularOpeningHours',
      'location',
      'types',
      'addressComponents',
    ].join(',')

    // Call Google Places Details (New) API
    const detailsUrl = `https://places.googleapis.com/v1/places/${params.place_id}?key=${googleApiKey}`

    const detailsResponse = await fetch(detailsUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-FieldMask': fieldMask,
      },
    })

    const detailsData = await detailsResponse.json()

    if (detailsData.error) {
      console.error('Google Places Details API error:', detailsData.error)
      throw new ApiError(500, `Google Places API error: ${detailsData.error.message}`)
    }

    const place = detailsData

    // Extract city and country from addressComponents
    let city: string | null = null
    let country: string | null = null

    if (place.addressComponents) {
      for (const component of place.addressComponents) {
        if (component.types.includes('locality')) {
          city = component.longName || component.shortName
        }
        if (component.types.includes('country')) {
          country = component.longName || component.shortName
        }
      }
    }

    // Try to infer chain from name (basic heuristic)
    const displayName = place.displayName?.text || ''
    let chain: string | null = null
    const chainKeywords = ['Marriott', 'Hilton', 'Hyatt', 'IHG', 'Accor', 'Four Seasons', 'Ritz-Carlton', 'Westin', 'Sheraton', 'Holiday Inn']
    for (const keyword of chainKeywords) {
      if (displayName.includes(keyword)) {
        chain = keyword
        break
      }
    }

    // Transform to our format
    const placeDetails: PlaceDetails = {
      place_id: place.id,
      name: displayName,
      address: place.formattedAddress || '',
      formatted_address: place.formattedAddress,
      phone: place.nationalPhoneNumber || place.internationalPhoneNumber,
      website: place.websiteUri,
      rating: place.rating,
      user_rating_count: place.userRatingCount,
      price_level: place.priceLevel,
      photos: place.photos?.map((p: any) => p.name).slice(0, 10) || [],
      reviews: place.reviews?.slice(0, 5) || [],
      opening_hours: place.regularOpeningHours || place.currentOpeningHours,
      lat: place.location?.latitude,
      lng: place.location?.longitude,
      types: place.types,
      chain,
      city,
      country,
    }

    // Update cache
    await supabaseAdmin
      .from('place_cache')
      .upsert({
        place_id: params.place_id,
        name: displayName,
        chain,
        city,
        country,
        details: placeDetails,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'place_id' })

    return jsonResponse({
      ...placeDetails,
      cached: false,
    })

  } catch (error) {
    return errorResponse(error)
  }
})
