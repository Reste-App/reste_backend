// Places Details Edge Function
// Proxy for Google Places Details API with 7-day caching

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
  user_ratings_total?: number
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
    // Verify authentication
    const { supabaseAdmin } = await verifyAuth(req)

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

    if (!cacheError && cached) {
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

    // Call Google Places Details API
    const fields = [
      'place_id',
      'name',
      'formatted_address',
      'vicinity',
      'formatted_phone_number',
      'international_phone_number',
      'website',
      'rating',
      'user_ratings_total',
      'price_level',
      'photos',
      'reviews',
      'opening_hours',
      'geometry',
      'types',
      'address_components',
    ].join(',')

    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${params.place_id}&fields=${fields}&key=${googleApiKey}`
    
    const detailsResponse = await fetch(detailsUrl)
    const detailsData = await detailsResponse.json()

    if (detailsData.status !== 'OK') {
      console.error('Google Places Details API error:', detailsData)
      throw new ApiError(500, `Google Places API error: ${detailsData.status}`)
    }

    const place = detailsData.result

    // Extract chain, city, country from address components
    let chain: string | null = null
    let city: string | null = null
    let country: string | null = null

    if (place.address_components) {
      for (const component of place.address_components) {
        if (component.types.includes('locality')) {
          city = component.long_name
        }
        if (component.types.includes('country')) {
          country = component.long_name
        }
      }
    }

    // Try to infer chain from name (basic heuristic)
    const chainKeywords = ['Marriott', 'Hilton', 'Hyatt', 'IHG', 'Accor', 'Four Seasons', 'Ritz-Carlton']
    for (const keyword of chainKeywords) {
      if (place.name.includes(keyword)) {
        chain = keyword
        break
      }
    }

    // Transform to our format
    const placeDetails: PlaceDetails = {
      place_id: place.place_id,
      name: place.name,
      address: place.vicinity || place.formatted_address || '',
      formatted_address: place.formatted_address,
      phone: place.formatted_phone_number || place.international_phone_number,
      website: place.website,
      rating: place.rating,
      user_ratings_total: place.user_ratings_total,
      price_level: place.price_level,
      photos: place.photos?.map((p: any) => p.photo_reference).slice(0, 10) || [],
      reviews: place.reviews?.slice(0, 5) || [],
      opening_hours: place.opening_hours,
      lat: place.geometry?.location?.lat,
      lng: place.geometry?.location?.lng,
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
        name: place.name,
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
