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
    const { lat, lon, radius = 10000 } = await req.json();
    
    if (!lat || !lon) {
      return new Response(JSON.stringify({ error: 'lat and lon are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const radiusMeters = Math.min(radius, 50000);
    const query = `
      [out:json][timeout:60];
      (
        node["amenity"="hospital"](around:${radiusMeters},${lat},${lon});
        node["amenity"="clinic"](around:${radiusMeters},${lat},${lon});
        node["amenity"="pharmacy"](around:${radiusMeters},${lat},${lon});
        node["amenity"="doctors"](around:${radiusMeters},${lat},${lon});
        way["amenity"="hospital"](around:${radiusMeters},${lat},${lon});
        way["amenity"="clinic"](around:${radiusMeters},${lat},${lon});
      );
      out center body;
    `;

    const overpassUrls = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ];

    let response: Response | null = null;
    let lastError = '';

    for (const url of overpassUrls) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          response = await fetch(url, {
            method: 'POST',
            body: `data=${encodeURIComponent(query)}`,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            signal: AbortSignal.timeout(45000),
          });
          if (response.ok) break;
          lastError = `${url} returned ${response.status}`;
          response = null;
        } catch (e) {
          lastError = `${url}: ${e instanceof Error ? e.message : 'Unknown error'}`;
          response = null;
        }
        if (attempt === 0) await new Promise(r => setTimeout(r, 2000));
      }
      if (response?.ok) break;
    }

    if (!response || !response.ok) {
      throw new Error(`Overpass API unavailable: ${lastError}`);
    }

    const data = await response.json();
    
    const facilities = data.elements.map((el: any) => {
      const facilityLat = el.lat || el.center?.lat;
      const facilityLon = el.lon || el.center?.lon;
      const tags = el.tags || {};
      
      let type = 'healthcare';
      if (tags.amenity === 'hospital') type = 'hospital';
      else if (tags.amenity === 'clinic') type = 'clinic';
      else if (tags.amenity === 'pharmacy') type = 'pharmacy';
      else if (tags.amenity === 'doctors') type = 'doctors';

      return {
        id: el.id,
        name: tags.name || tags['name:en'] || `${type.charAt(0).toUpperCase() + type.slice(1)}`,
        type,
        lat: facilityLat,
        lon: facilityLon,
        tags,
      };
    }).filter((f: any) => f.lat && f.lon);

    // Deduplicate by proximity
    const seen = new Set();
    const unique = facilities.filter((f: any) => {
      const key = `${f.lat.toFixed(4)},${f.lon.toFixed(4)},${f.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return new Response(JSON.stringify({ facilities: unique }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching facilities:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
