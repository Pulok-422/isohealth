import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getVisitorId } from '@/lib/visitor';

export function useVisitorTracking() {
  const tracked = useRef(false);

  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;

    const visitorId = getVisitorId();

    supabase.auth.getUser().then(({ data: { user } }) => {
      supabase
        .from('site_visits')
        .insert({
          visitor_id: visitorId,
          user_id: user?.id || null,
          page_path: window.location.pathname,
          referrer: document.referrer || null,
          user_agent: navigator.userAgent,
        })
        .then(() => {});
    });
  }, []);
}
