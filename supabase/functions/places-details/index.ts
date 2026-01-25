// Places Details Edge Function
// Proxy for Google Places Details (New) API with 7-day caching

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'
import { verifyAuth, ApiError, jsonResponse, errorResponse, corsHeaders, handleCors } from '../_shared/utils.ts'

const DetailsParamsSchema = z.object({
  place_id: z.string().min(1),
  refresh: z.string().optional(), // If "true", bypass cache
})

const CACHE_TTL_DAYS = 7

interface PlaceDetails {
  place_id: string
  name: string
  address: string
  formatted_address?: string
  phone?: string
  website?: string
  price_level?: number
  photos?: string[]
  opening_hours?: any
  lat?: number
  lng?: number
  chain?: string
  city?: string
  country?: string
  // Containing places (restaurants, bars, etc. at the hotel)
  containing_places?: any[]
  // Amex benefits fields (optional)
  program_type?: 'FHR' | 'THC' | null
  benefits?: string[] | null
  price_calendar_link?: string | null
  amex_reservation_link?: string | null
  hotelft_link?: string | null
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
      refresh: url.searchParams.get('refresh') || undefined,
    })

    // Check if refresh is requested
    const forceRefresh = params.refresh === 'true'

    // Check cache first (unless refresh is requested)
    if (!forceRefresh) {
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
    } else {
      console.log(`Cache bypass requested for place_id: ${params.place_id}`)
    }

    // Cache miss, expired, or refresh requested - fetch from Google and Amex data
    console.log(`Fetching from Google for place_id: ${params.place_id}`)

    const googleApiKey = Deno.env.get('GOOGLE_PLACES_API_KEY')
    if (!googleApiKey) {
      throw new ApiError(500, 'Google Places API key not configured')
    }

    // Define the fields we want from Place Details (New) API
    // Removed: rating, userRatingCount, reviews, types (cost savings)
    // Added: containingPlaces (shows restaurants, bars, etc. at the hotel)
    const fieldMask = [
      'id',
      'displayName',
      'formattedAddress',
      'nationalPhoneNumber',
      'internationalPhoneNumber',
      'websiteUri',
      'priceLevel',
      'photos',
      'currentOpeningHours',
      'regularOpeningHours',
      'location',
      'addressComponents',
      'containingPlaces',
    ].join(',')

    // Call Google Places Details (New) API
    const detailsUrl = `https://places.googleapis.com/v1/places/${params.place_id}?key=${googleApiKey}`

    // Fetch Google Places data and Amex hotel data in parallel for better performance
    const [googleResponse, amexResponse] = await Promise.all([
      fetch(detailsUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-FieldMask': fieldMask,
        },
      }),
      // Query Amex hotels table for program benefits and links
      supabaseAdmin
        .from('hotels')
        .select('program, credit, early_checkin, free_breakfast, free_wifi, late_checkout, room_upgrade, price_calendar, amex_reservation, hotelft_link')
        .eq('google_place_id', params.place_id)
        .single()
    ])

    const detailsData = await googleResponse.json()

    if (detailsData.error) {
      console.error('Google Places Details API error:', detailsData.error)
      throw new ApiError(500, `Google Places API error: ${detailsData.error.message}`)
    }

    const place = detailsData

    // Check if Amex data exists
    const amexHotel = !amexResponse.error && amexResponse.data ? amexResponse.data : null

    // Build benefits array from individual benefit fields
    let benefits: string[] | null = null
    if (amexHotel) {
      benefits = []
      if (amexHotel.credit) benefits.push(amexHotel.credit)
      if (amexHotel.early_checkin) benefits.push('Early check-in')
      if (amexHotel.free_breakfast) benefits.push('Free breakfast')
      if (amexHotel.free_wifi) benefits.push('Free WiFi')
      if (amexHotel.late_checkout) benefits.push('Late checkout')
      if (amexHotel.room_upgrade) benefits.push('Room upgrade')
      if (benefits.length === 0) benefits = null

      console.log(`✅ Amex data found: ${amexHotel.program} with ${benefits?.length || 0} benefits`)
    } else {
      console.log(`ℹ️ No Amex data found for place_id: ${params.place_id}`)
    }

    // Fetch actual photo URLs from Google Photos API and cache them
    // This saves Photo API credits on subsequent requests
    const photoUrls: string[] = []
    const maxPhotos = Math.min((place.photos?.length || 0), 10)

    for (let i = 0; i < maxPhotos; i++) {
      const photoName = place.photos[i]?.name
      if (photoName) {
        // Build the photo URL with skipHttpRedirect to get the actual CDN URL
        // This way we cache the direct Google CDN link instead of the photo reference
        const photoApiUrl = `https://places.googleapis.com/v1/${photoName}/media?key=${googleApiKey}&maxWidthPx=400&maxHeightPx=300&skipHttpRedirect=true`

        try {
          const photoResponse = await fetch(photoApiUrl, {
            method: 'GET',
          })

          if (photoResponse.ok) {
            const photoData = await photoResponse.json()
            // photoData.photoUri contains the actual Google CDN URL
            if (photoData.photoUri) {
              photoUrls.push(photoData.photoUri)
              console.log(`Resolved photo ${i + 1}/${maxPhotos}: ${photoData.photoUri}`)
            }
          }
        } catch (error) {
          console.error(`Failed to fetch photo URL ${i}:`, error)
          // If photo URL fetch fails, fall back to the reference
          photoUrls.push(photoName)
        }
      }
    }

    // Debug logging to see what Google returns
    console.log('Google Places API response keys:', Object.keys(place))
    console.log('Has photos?', !!place.photos)
    console.log('Photos count:', place.photos?.length || 0)
    console.log('Photos sample:', place.photos?.slice(0, 2))

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
      price_level: place.priceLevel,
      // Use resolved photo URLs (direct Google CDN links) instead of photo references
      // This avoids Photo API calls on every render
      photos: photoUrls.length > 0 ? photoUrls : place.photos?.map((p: any) => p.name).slice(0, 10) || [],
      opening_hours: place.regularOpeningHours || place.currentOpeningHours,
      lat: place.location?.latitude,
      lng: place.location?.longitude,
      chain,
      city,
      country,
      // Add containing places (restaurants, bars, etc.)
      containing_places: place.containingPlaces || [],
      // Add Amex benefits data if available
      program_type: amexHotel?.program || null,
      benefits,
      price_calendar_link: amexHotel?.price_calendar || null,
      amex_reservation_link: amexHotel?.amex_reservation || null,
      hotelft_link: amexHotel?.hotelft_link || null,
    }

    // Debug logging to see what we're returning
    console.log('Returning placeDetails keys:', Object.keys(placeDetails))
    console.log('Returning photos count:', placeDetails.photos?.length || 0)
    console.log('Sample photos:', placeDetails.photos?.slice(0, 2))

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
