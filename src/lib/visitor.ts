// Visitor tracking utilities
const VISITOR_ID_KEY = 'isohealth_visitor_id';

function generateVisitorId(): string {
  return 'v_' + crypto.randomUUID();
}

export function getVisitorId(): string {
  let id = localStorage.getItem(VISITOR_ID_KEY);
  if (!id) {
    id = generateVisitorId();
    localStorage.setItem(VISITOR_ID_KEY, id);
  }
  return id;
}
