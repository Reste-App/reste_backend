// Vibe Summary Edge Function
// GET /vibe-summary?place_id=xxx - Get or generate AI summary for a hotel

import {
  ApiError,
  jsonResponse,
  errorResponse,
  handleCors,
} from '../_shared/utils.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

// Category configuration with icons
const CATEGORY_CONFIG: Record<string, { icon: string; label: string }> = {
  vibe: { icon: '✨', label: 'Vibe' },
  bedding: { icon: '🛏️', label: 'Bedding' },
  view: { icon: '🏞️', label: 'View' },
  cleanliness: { icon: '✨', label: 'Cleanliness' },
  toiletries: { icon: '🧴', label: 'Toiletries' },
  value: { icon: '💰', label: 'Value' },
}

interface VibeResponse {
  category_id: string
  sentiment: string
  response_text: string
}

interface CategorySummary {
  id: string
  icon: string
  label: string
  count: number
  title: string
  text: string
  positive: number
  neutral: number
  negative: number
}

interface FollowUpQuestion {
  question: string
  answer: string
  sourceDetails: string[]
}

interface GeminiResponse {
  summary: string
  categories: CategorySummary[]
  followUpQuestions: FollowUpQuestion[]
}

/**
 * Call Gemini API to generate summary
 */
async function generateSummaryWithGemini(
  hotelName: string,
  responses: VibeResponse[]
): Promise<GeminiResponse> {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) {
    throw new ApiError(500, 'Gemini API key not configured')
  }

  // Group responses by category for the prompt
  const categoryResponses = new Map<string, VibeResponse[]>()
  for (const response of responses) {
    const existing = categoryResponses.get(response.category_id) || []
    existing.push(response)
    categoryResponses.set(response.category_id, existing)
  }

  // Build prompt
  const responsesText = responses
    .map(r => `[${r.category_id.toUpperCase()}] (${r.sentiment}): "${r.response_text}"`)
    .join('\n')

  const categoriesForPrompt = Array.from(categoryResponses.keys())
    .map(cat => {
      const config = CATEGORY_CONFIG[cat] || { icon: '📝', label: cat }
      return `- ${cat}: icon="${config.icon}", label="${config.label}"`
    })
    .join('\n')

  const prompt = `You are analyzing guest feedback for a hotel called "${hotelName}".

Based on these guest responses, generate:
1. A 2-3 sentence overall summary (max 200 characters) that captures key themes and insights
2. For each category that has responses, generate a detailed insight paragraph and calculate sentiment breakdown
3. CRITICAL: Extract 1-3 specific factual details mentioned by guests and convert them into follow-up questions

Guest responses:
${responsesText}

Categories to analyze:
${categoriesForPrompt}

IMPORTANT: Return ONLY valid JSON in this exact format, no markdown or extra text:
{
  "summary": "Key themes and insights from guest feedback...",
  "categories": [
    {
      "id": "bedding",
      "icon": "🛏️",
      "label": "Bedding",
      "count": 5,
      "title": "What guests say about Bedding",
      "text": "2-3 sentence detailed insight with key themes...",
      "positive": 80,
      "neutral": 15,
      "negative": 5
    }
  ],
  "followUpQuestions": [
    {
      "question": "What toiletry brand do they use?",
      "answer": "According to guests, the hotel uses Lullabo toiletries.",
      "sourceDetails": ["Lullabo toiletries mentioned in responses"]
    },
    {
      "question": "What type of bedding?",
      "answer": "Reviews mention Marriott bedding with premium linens.",
      "sourceDetails": ["Marriott bedding mentioned"]
    }
  ]
}

Rules for Summary:
- 2-3 sentences that capture key themes and insights
- Focus on what guests consistently mention (patterns, not outliers)
- Include specific themes (e.g., "amazing city views", "comfortable bedding")
- Max 200 characters

Rules for Category Text:
- 2-3 sentences per category
- Highlight key themes and patterns
- Mention specific details if multiple guests agree
- More detailed than just sentiment

CRITICAL Rules for Follow-up Questions (MUST GENERATE 1-3 IF SPECIFIC DETAILS EXIST):
- Extract 1-3 specific factual details (brands, amenities, features, room types, landmarks)
- Look for: brand names (Lullabo, Marriott, Keurig), specific amenities (rainfall shower, coffee maker), room features (corner room, lake view), landmarks (Downtown Chicago)
- Each detail MUST become a follow-up question with pre-generated answer
- Questions should be natural: "What [X] do they have?", "What type of [X]?"
- Answers must quote what guests said
- sourceDetails should list the specific phrases from responses
- You MUST generate follow-up questions if guests mention specific brands, amenities, or features
- Only return empty array if responses are generic with no specific details

Rules for Sentiment:
- Percentages must add up to 100 for each category
- Base percentages on actual good/fine/bad ratings in responses`

  // Call Gemini API
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048,
        },
      }),
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Gemini API error:', errorText)
    throw new ApiError(500, 'Failed to generate summary with AI')
  }

  const geminiResult = await response.json()

  // Extract text from Gemini response
  const generatedText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text
  if (!generatedText) {
    console.error('No text in Gemini response:', geminiResult)
    throw new ApiError(500, 'No content generated by AI')
  }

  // Parse JSON from response (handle potential markdown code blocks)
  let jsonText = generatedText.trim()
  if (jsonText.startsWith('```json')) {
    jsonText = jsonText.slice(7)
  }
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.slice(3)
  }
  if (jsonText.endsWith('```')) {
    jsonText = jsonText.slice(0, -3)
  }
  jsonText = jsonText.trim()

  try {
    const parsed = JSON.parse(jsonText) as GeminiResponse
    // Log the parsed response to debug follow-up questions
    console.log('Gemini parsed response:', JSON.stringify({
      summary: parsed.summary,
      followUpQuestionsCount: parsed.followUpQuestions?.length || 0,
      followUpQuestions: parsed.followUpQuestions
    }, null, 2))
    return parsed
  } catch (parseError) {
    console.error('Failed to parse Gemini response:', jsonText)
    throw new ApiError(500, 'Failed to parse AI response')
  }
}

/**
 * Generate a fallback summary without AI (when no API key or error)
 */
function generateFallbackSummary(responses: VibeResponse[]): GeminiResponse {
  // Group by category
  const categoryGroups = new Map<string, VibeResponse[]>()
  for (const r of responses) {
    const existing = categoryGroups.get(r.category_id) || []
    existing.push(r)
    categoryGroups.set(r.category_id, existing)
  }

  // Calculate sentiment stats
  let totalPositive = 0
  let totalNeutral = 0
  let totalNegative = 0
  for (const r of responses) {
    if (r.sentiment === 'good') totalPositive++
    else if (r.sentiment === 'fine') totalNeutral++
    else totalNegative++
  }

  const total = responses.length || 1
  const overallPositive = Math.round((totalPositive / total) * 100)

  // Generate simple summary
  let summary = 'Guests have shared their experiences. '
  if (overallPositive >= 70) {
    summary = 'Guests are very positive about this hotel. '
  } else if (overallPositive >= 50) {
    summary = 'Guests have mixed but mostly positive feedback. '
  } else {
    summary = 'Guest feedback varies for this property. '
  }

  // Generate category summaries
  const categories: CategorySummary[] = []
  for (const [catId, catResponses] of categoryGroups) {
    const config = CATEGORY_CONFIG[catId] || { icon: '📝', label: catId }

    let positive = 0, neutral = 0, negative = 0
    for (const r of catResponses) {
      if (r.sentiment === 'good') positive++
      else if (r.sentiment === 'fine') neutral++
      else negative++
    }

    const catTotal = catResponses.length || 1

    categories.push({
      id: catId,
      icon: config.icon,
      label: config.label,
      count: catResponses.length,
      title: `What guests say about ${config.label}`,
      text: catResponses.slice(0, 3).map(r => r.response_text).join(' '),
      positive: Math.round((positive / catTotal) * 100),
      neutral: Math.round((neutral / catTotal) * 100),
      negative: Math.round((negative / catTotal) * 100),
    })
  }

  return { summary, categories, followUpQuestions: [] }
}

Deno.serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    // Vibe summaries are intentionally public — they aggregate responses across all
    // users for a given hotel and are shown on the hotel detail page without login.
    // No auth is required or attempted.
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Only allow GET
    if (req.method !== 'GET') {
      throw new ApiError(405, 'Method not allowed')
    }

    // Get place_id from query params
    const url = new URL(req.url)
    const placeId = url.searchParams.get('place_id')
    if (!placeId) {
      throw new ApiError(400, 'place_id query parameter is required')
    }

    // Check for refresh parameter to bypass cache
    const refresh = url.searchParams.get('refresh') === 'true'

    // Check for cached summary that hasn't expired (unless refresh=true)
    const { data: cachedSummary } = await supabaseAdmin
      .from('vibe_summaries')
      .select('*')
      .eq('place_id', placeId)
      .single()

    const now = new Date()
    if (!refresh && cachedSummary && new Date(cachedSummary.expires_at) > now) {
      // Return cached summary
      return jsonResponse({
        place_id: placeId,
        summary_text: cachedSummary.summary_text,
        total_responses: cachedSummary.total_responses,
        categories: cachedSummary.categories,
        follow_up_questions: cachedSummary.follow_up_questions || [],
        generated_at: cachedSummary.generated_at,
        cached: true,
      })
    }

    // Fetch all responses for this place
    const { data: responses, error: responsesError } = await supabaseAdmin
      .from('vibe_responses')
      .select('category_id, sentiment, response_text')
      .eq('place_id', placeId)

    if (responsesError) {
      console.error('Error fetching responses:', responsesError)
      throw new ApiError(500, 'Failed to fetch responses')
    }

    // If no responses, return empty state
    if (!responses || responses.length === 0) {
      return jsonResponse({
        place_id: placeId,
        summary_text: null,
        total_responses: 0,
        categories: [],
        follow_up_questions: [],
        generated_at: null,
        cached: false,
      })
    }

    // Get hotel name from place_cache if available
    const { data: placeCache } = await supabaseAdmin
      .from('place_cache')
      .select('name')
      .eq('place_id', placeId)
      .single()

    const hotelName = placeCache?.name || 'this hotel'

    // Generate summary with Gemini (or fallback)
    let generatedSummary: GeminiResponse
    try {
      generatedSummary = await generateSummaryWithGemini(hotelName, responses)
    } catch (error) {
      console.error('Gemini generation failed, using fallback:', error)
      generatedSummary = generateFallbackSummary(responses)
    }

    // Cache the summary
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000) // 24 hours

    await supabaseAdmin
      .from('vibe_summaries')
      .upsert({
        place_id: placeId,
        summary_text: generatedSummary.summary,
        total_responses: responses.length,
        categories: generatedSummary.categories,
        follow_up_questions: generatedSummary.followUpQuestions || [],
        generated_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        updated_at: now.toISOString(),
      }, {
        onConflict: 'place_id',
      })

    return jsonResponse({
      place_id: placeId,
      summary_text: generatedSummary.summary,
      total_responses: responses.length,
      categories: generatedSummary.categories,
      follow_up_questions: generatedSummary.followUpQuestions || [],
      generated_at: now.toISOString(),
      cached: false,
    })

  } catch (error) {
    return errorResponse(error)
  }
})
