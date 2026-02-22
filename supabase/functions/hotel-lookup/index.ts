import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyAuth } from '../_shared/utils.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

Deno.serve(async (req: Request) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      },
    });
  }

  try {
    await verifyAuth(req)

    // Get place_id from URL query params
    const url = new URL(req.url);
    const placeId = url.searchParams.get('place_id');

    if (!placeId) {
      return new Response(
        JSON.stringify({ error: 'place_id query parameter is required' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // Query Supabase for hotel with matching google_place_id
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { data: hotel, error } = await supabase
      .from('hotels')
      .select('*')
      .eq('google_place_id', placeId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No hotel found - return null with 200 status
        return new Response(
          JSON.stringify({ hotel: null }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          }
        );
      }
      throw error;
    }

    return new Response(
      JSON.stringify({ hotel }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
});
