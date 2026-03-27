import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ORS_API_KEY = Deno.env.get('ORS_API_KEY');
    if (!ORS_API_KEY) {
      return new Response(JSON.stringify({ error: 'ORS_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { lat, lon, profile = 'foot-walking', ranges, range_type = 'time' } = await req.json();

    if (!lat || !lon) {
      return new Response(JSON.stringify({ error: 'lat and lon are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Default ranges: 10-60 min (seconds) or 1-6 km (meters)
    const defaultRanges = range_type === 'distance'
      ? [1000, 2000, 3000, 4000, 5000, 6000]
      : [600, 1200, 1800, 2400, 3000, 3600];

    const finalRanges = ranges && ranges.length > 0 ? ranges : defaultRanges;

    console.log(`Isochrone request: profile=${profile}, range_type=${range_type}, ranges=${JSON.stringify(finalRanges)}`);

    const response = await fetch(`https://api.openrouteservice.org/v2/isochrones/${profile}`, {
      method: 'POST',
      headers: {
        'Authorization': ORS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        locations: [[lon, lat]],
        range: finalRanges,
        range_type,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ORS isochrones error [${response.status}]: ${errorText}`);
    }

    const data = await response.json();

    // Validate response
    console.log(`Isochrone feature count: ${data.features?.length}`);
    console.log(`Isochrone values: ${data.features?.map((f: any) => f.properties?.value)}`);

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error: unknown) {
    console.error('Error generating isochrones:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
