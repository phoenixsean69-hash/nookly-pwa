import type { Property } from '../types';

export interface Coordinates { latitude: number; longitude: number }

/** Do not coerce undefined, null, or blank values into 0,0. */
export function parseCoordinates(latitude: unknown, longitude: unknown): Coordinates | null {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) return null;
  if (String(latitude).trim() === '' || String(longitude).trim() === '') return null;
  const lat = Number(latitude), lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  // 0,0 is nearly always a missing-data sentinel in the Nookly property catalogue.
  if (lat === 0 && lon === 0) return null;
  return { latitude: lat, longitude: lon };
}

export function propertyCoordinates(property: Property): Coordinates | null {
  return parseCoordinates(property.latitude, property.longitude);
}

export function distanceKm(a: Coordinates, b: Coordinates): number {
  const toRad = (degrees: number) => degrees * Math.PI / 180;
  const lat1 = toRad(a.latitude), lat2 = toRad(b.latitude);
  const deltaLat = lat2 - lat1, deltaLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)));
}

export const distanceText = (km: number) => km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;

export function openMapsUrl(coords: Coordinates): string {
  return `https://www.openstreetmap.org/?mlat=${coords.latitude}&mlon=${coords.longitude}#map=16/${coords.latitude}/${coords.longitude}`;
}

/** External OSRM car routing via OSM. Opens an actual router; no invented ETA. */
export function directionsUrl(from: Coordinates, to: Coordinates): string {
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(`${from.latitude},${from.longitude};${to.latitude},${to.longitude}`)}`;
}

export function propertyHasCoordinates(property: Property): boolean { return !!propertyCoordinates(property); }
