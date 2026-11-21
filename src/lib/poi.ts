import { distanceKm, parseCoordinates, type Coordinates } from './geo';

export const POI_CATEGORIES = [
  { id: 'schools', label: 'Schools', color: '#2563eb', glyph: '🎓' },
  { id: 'universities', label: 'Universities', color: '#7c3aed', glyph: '🏛️' },
  { id: 'hospitals', label: 'Health services', color: '#dc2626', glyph: '✚' },
  { id: 'shopping', label: 'Shopping', color: '#d97706', glyph: '🛒' },
  { id: 'busTerminals', label: 'Public transport', color: '#059669', glyph: '🚌' },
  { id: 'policeStations', label: 'Police', color: '#475569', glyph: '🛡' },
  { id: 'restaurants', label: 'Food & restaurants', color: '#ea580c', glyph: '☕' },
  { id: 'parks', label: 'Parks', color: '#65a30d', glyph: '🌳' },
  { id: 'fuelStations', label: 'Fuel stations', color: '#0891b2', glyph: '⛽' },
] as const;
export type PoiCategory = typeof POI_CATEGORIES[number]['id'];
export type Poi = { id: string; name: string; category: PoiCategory; coordinates: Coordinates; distanceKm: number; address: string };

type Element = { type: 'node'|'way'|'relation'; id: number; lat?:number; lon?:number; center?:{lat:number;lon:number}; tags?:Record<string,string> };
const ttlMs = 30 * 60_000;
const cache = new Map<string, {time: number; items: Poi[]}>();
const pending = new Map<string, Promise<Poi[]>>();
const endpoints = ['https://overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter'];

export function categoryOf(tags: Record<string,string>): PoiCategory | null {
  const a = tags.amenity, s = tags.shop, l = tags.leisure;
  if (a === 'school' || a === 'kindergarten') return 'schools';
  if (a === 'university' || a === 'college') return 'universities';
  if (['hospital','clinic','doctors','pharmacy','dentist'].includes(a)) return 'hospitals';
  if (s || ['marketplace','supermarket'].includes(a)) return 'shopping';
  if (a === 'bus_station' || tags.highway === 'bus_stop' || tags.public_transport) return 'busTerminals';
  if (a === 'police') return 'policeStations';
  if (['restaurant','cafe','fast_food','food_court'].includes(a)) return 'restaurants';
  if (['park','garden','playground'].includes(l)) return 'parks';
  if (a === 'fuel') return 'fuelStations';
  return null;
}

function queryFor(center: Coordinates, radiusKm: number): string {
  const around = `around:${Math.round(radiusKm * 1000)},${center.latitude},${center.longitude}`;
  return `[out:json][timeout:18];(nwr(around:${Math.round(radiusKm * 1000)},${center.latitude},${center.longitude})[amenity~"^(school|kindergarten|university|college|hospital|clinic|doctors|pharmacy|dentist|marketplace|bus_station|police|restaurant|cafe|fast_food|food_court|fuel)$"];nwr(${around})[shop];nwr(${around})[leisure~"^(park|garden|playground)$"];nwr(${around})[highway=bus_stop];nwr(${around})[public_transport];);out center 350;`;
}

export function parsePois(elements: Element[], center: Coordinates, radiusKm: number): Poi[] {
  const items = new Map<string,Poi>();
  for (const item of elements) {
    const cat = categoryOf(item.tags || {});
    if (!cat) continue;
    const coords = parseCoordinates(item.lat ?? item.center?.lat, item.lon ?? item.center?.lon);
    if (!coords) continue;
    const distance = distanceKm(center, coords);
    if (distance > radiusKm + 0.02) continue;
    const id = `${item.type}/${item.id}`;
    const tags = item.tags || {};
    items.set(id, { id, name: (tags.name || tags.brand || POI_CATEGORIES.find(p => p.id === cat)?.label || 'Mapped place').slice(0,130), category:cat, coordinates:coords, distanceKm:distance, address:[tags['addr:housenumber'],tags['addr:street'],tags['addr:suburb']].filter(Boolean).join(' ').slice(0,180) });
  }
  return [...items.values()].sort((a,b)=>a.distanceKm-b.distanceKm).slice(0,250);
}

export function loadPois(center:Coordinates, radiusKm=2):Promise<Poi[]> {
  const radius = Math.max(.5, Math.min(5,radiusKm));
  const key = `${center.latitude.toFixed(4)}:${center.longitude.toFixed(4)}:${radius}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < ttlMs) return Promise.resolve(cached.items);
  if (pending.has(key)) return pending.get(key)!;
  const task = (async()=>{
    if (!navigator.onLine) throw new Error('Nearby places need an internet connection.');
    let lastError = 'Nearby places could not be loaded right now.';
    for (const endpoint of endpoints) {
      const controller = new AbortController();
      const timer = setTimeout(()=>controller.abort(), 19000);
      try {
        const response = await fetch(endpoint, {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:`data=${encodeURIComponent(queryFor(center,radius))}`,signal:controller.signal});
        if (!response.ok) throw new Error(`Map service returned ${response.status}`);
        const data = await response.json() as {elements?:Element[]};
        if (!Array.isArray(data.elements)) throw new Error('Invalid nearby-places response');
        const items = parsePois(data.elements,center,radius);
        cache.set(key,{time:Date.now(),items});
        return items;
      } catch(e) {lastError = e instanceof Error ? e.message : lastError;} finally {clearTimeout(timer);}
    }
    throw new Error(`Nearby places are temporarily unavailable. ${lastError}`);
  })();
  pending.set(key,task);
  void task.finally(()=>pending.delete(key)).catch(()=>{});
  return task;
}
