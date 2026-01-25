// Vibe Answer Question Edge Function
// POST /vibe-answer-question - Answer a follow-up question about a hotel

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'

// Schema for the request body
const VibeAnswerQuestionBodySchema = z.object({
  place_id: z.string().min(1),
  question: z.string().min(1),
})

// Custom API error class
class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Handle CORS preflight
function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return null
}

// Standard JSON response helper
function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  })
}

// Error response helper
function errorResponse(error: unknown): Response {
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

interface VibeResponse {
  category_id: string
  sentiment: string
  response_text: string
}

Deno.serve(async (req) => {
  // Handle CORS
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    // Only allow POST
    if (req.method !== 'POST') {
      throw new ApiError(405, 'Method not allowed')
    }

    // Parse and validate body
    const body = await req.json()
    const data = VibeAnswerQuestionBodySchema.parse(body)
    const placeId = data.place_id
    const question = data.question

    // Create admin client (no auth required for read-only vibe responses)
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.39.0')
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Fetch all vibe responses for this place
    const { data: responses, error: responsesError } = await supabaseAdmin
      .from('vibe_responses')
      .select('category_id, sentiment, response_text')
      .eq('place_id', placeId)

    if (responsesError) {
      console.error('Error fetching responses:', responsesError)
      throw new ApiError(500, 'Failed to fetch responses')
    }

    // If no responses, return empty answer
    if (!responses || responses.length === 0) {
      return jsonResponse({
        answer: 'No guest feedback available for this hotel yet.',
        question,
        relatedTopics: [],
      })
    }

    // Get hotel name from place_cache if available
    const { data: placeCache } = await supabaseAdmin
      .from('place_cache')
      .select('name')
      .eq('place_id', placeId)
      .single()

    const hotelName = placeCache?.name || 'this hotel'

    // Build responses text for the prompt
    const responsesText = responses
      .map(r => `[${r.category_id.toUpperCase()}] (${r.sentiment}): "${r.response_text}"`)
      .join('\n')

    // Build prompt for answering the question
    const prompt = `You are helping answer a user's question about a hotel called "${hotelName}" based on guest feedback.

The user's question is: "${question}"

Here is the guest feedback:
${responsesText}

IMPORTANT: Answer the user's question based ONLY on the guest feedback above.

Rules:
- If the feedback contains the answer, provide a clear, concise response (2-3 sentences)
- Quote or reference what guests said when relevant
- If the feedback doesn't contain enough information to answer the question, say so honestly
- Be specific and factual
- Do not make up information

Return your response as plain text (not JSON).`

    // Call Gemini API
    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) {
      throw new ApiError(500, 'Gemini API key not configured')
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
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
            maxOutputTokens: 1024,
          },
        }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Gemini API error:', errorText)
      throw new ApiError(500, 'Failed to generate answer')
    }

    const geminiResult = await response.json()

    // Extract text from Gemini response
    const answer = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text
    if (!answer) {
      console.error('No text in Gemini response:', geminiResult)
      throw new ApiError(500, 'No content generated by AI')
    }

    return jsonResponse({
      answer: answer.trim(),
      question,
      relatedTopics: [], // Could be expanded later to suggest related questions
    })

  } catch (error) {
    return errorResponse(error)
  }
})
