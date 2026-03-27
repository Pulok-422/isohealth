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

    const { origins, destinations, profile = 'driving-car' } = await req.json();

    const locations = [...origins.map((o: any) => [o.lon, o.lat]), ...destinations.map((d: any) => [d.lon, d.lat])];
    const sourceIndices = origins.map((_: any, i: number) => i);
    const destIndices = destinations.map((_: any, i: number) => i + origins.length);

    const response = await fetch(`https://api.openrouteservice.org/v2/matrix/${profile}`, {
      method: 'POST',
      headers: {
        'Authorization': ORS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        locations,
        sources: sourceIndices,
        destinations: destIndices,
        metrics: ['duration', 'distance'],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ORS matrix error [${response.status}]: ${errorText}`);
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error: unknown) {
    console.error('Error computing matrix:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
