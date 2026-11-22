import { getDb } from '../db/index.js';
import { listLeads } from './leads.js';
import {
  findSuppressionForContact,
  normalizePhone,
  normalizeEmail,
} from './suppressions.js';

const GOOGLE_PLACES_ENDPOINT =
  process.env.GOOGLE_PLACES_ENDPOINT || 'https://places.googleapis.com/v1/places:searchText';

const DEFAULT_CITY = 'Bengaluru';
const MAX_PAGE_SIZE = 20;
const REQUEST_TIMEOUT_MS = 15000;

export const GOOGLE_PLACES_CATEGORIES = [
  'Cafés',
  'Juice shops',
  'Bubble tea',
  'Restaurants',
  'QSRs',
  'Beverage chains',
  'Cloud kitchens',
];

const CATEGORY_QUERY = {
  'Cafés': 'cafes',
  'Juice shops': 'juice shops',
  'Bubble tea': 'bubble tea shops',
  'Restaurants': 'restaurants',
  'QSRs': 'quick service restaurants',
  'Beverage chains': 'beverage chains',
  'Cloud kitchens': 'cloud kitchens',
};

const STORAGE_POLICY = {
  place_ids: 'Place IDs may be retained subject to Google current terms.',
  other_fields: 'Other Google Places fields are transient and are not automatically written to the CRM.',
};

const ATTRIBUTION = 'Results and map data © Google';

class GooglePlacesError extends Error {
  constructor(message, status = 500, code = 'google_places_error') {
    super(message);
    this.name = 'GooglePlacesError';
    this.status = status;
    this.code = code;
  }
}

function getApiKey() {
  const value = process.env.GOOGLE_PLACES_API_KEY;
  return value ? String(value).trim() : '';
}

export function getGooglePlacesConfig() {
  return {
    configured: Boolean(getApiKey()),
    provider: 'google-places',
    endpoint: 'Google Places API (New) Text Search',
    default_city: DEFAULT_CITY,
    categories: GOOGLE_PLACES_CATEGORIES,
    max_results: MAX_PAGE_SIZE,
    attribution: ATTRIBUTION,
    storage_policy: STORAGE_POLICY,
  };
}

export function validateSearchInput(input = {}) {
  const errors = [];
  const data = {};

  const rawCity = input.city ?? input.q_city ?? DEFAULT_CITY;
  const city = String(rawCity ?? '').trim();
  if (!city) {
    errors.push({ field: 'city', message: 'City is required' });
  } else if (city.length > 100) {
    errors.push({ field: 'city', message: 'City must be 100 characters or fewer' });
  } else {
    data.city = city;
  }

  const rawCategory = input.category ?? input.business_category ?? 'Cafés';
  const category = String(rawCategory ?? '').trim();
  if (!GOOGLE_PLACES_CATEGORIES.includes(category)) {
    errors.push({
      field: 'category',
      message: `category must be one of: ${GOOGLE_PLACES_CATEGORIES.join(', ')}`,
    });
  } else {
    data.category = category;
  }

  const rawPageSize = input.page_size ?? input.pageSize ?? input.limit ?? MAX_PAGE_SIZE;
  const pageSize = Number(rawPageSize);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    errors.push({ field: 'page_size', message: `page_size must be an integer between 1 and ${MAX_PAGE_SIZE}` });
  } else {
    data.page_size = pageSize;
  }

  const rawPageToken = input.page_token ?? input.pageToken ?? '';
  const pageToken = String(rawPageToken ?? '').trim();
  if (pageToken.length > 500) {
    errors.push({ field: 'page_token', message: 'page_token is too long' });
  } else {
    data.page_token = pageToken || null;
  }

  return { errors, data };
}

function findCrmMatches(place) {
  const placeName = String(place.displayName?.text || '').trim().toLowerCase();
  const placePhone = normalizePhone(place.nationalPhoneNumber);
  const leads = listLeads();
  const existingLeadIds = leads
    .filter((lead) => {
      const sameName = String(lead.business_name || '').trim().toLowerCase() === placeName && placeName !== '';
      const samePhone = placePhone !== '' && normalizePhone(lead.phone) === placePhone;
      return sameName || samePhone;
    })
    .map((lead) => lead.id);

  const suppression = placePhone ? findSuppressionForContact({ phone: place.nationalPhoneNumber }) : null;
  const suppressionIds = suppression ? [suppression.id] : [];

  return {
    existing_lead_ids: existingLeadIds,
    suppressed: Boolean(suppression),
    suppression_ids: suppressionIds,
  };
}

function normalizePlace(place, category) {
  return {
    place_id: String(place.id || ''),
    name: String(place.displayName?.text || '').trim(),
    category,
    google_types: Array.isArray(place.types) ? place.types : [],
    business_status: place.businessStatus ? String(place.businessStatus) : null,
    address: String(place.formattedAddress || '').trim(),
    phone: String(place.nationalPhoneNumber || '').trim(),
    website: String(place.websiteUri || '').trim(),
    rating: typeof place.rating === 'number' ? place.rating : null,
    user_rating_count: typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
    google_maps_url: String(place.googleMapsUri || '').trim(),
    attribution: ATTRIBUTION,
    saved_to_crm: false,
    crm_matches: findCrmMatches(place),
  };
}

export async function searchGooglePlaces(input = {}) {
  const { errors, data } = validateSearchInput(input);
  if (errors.length) {
    throw new GooglePlacesError(errors.map((e) => `${e.field}: ${e.message}`).join('; '), 400, 'validation_error');
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new GooglePlacesError(
      'Google Places API key is not configured. Set GOOGLE_PLACES_API_KEY on the server.',
      503,
      'missing_api_key'
    );
  }

  const startedAt = Date.now();
  const city = data.city;
  const category = data.category;
  const pageSize = data.page_size;
  const pageToken = data.page_token;

  const requestBody = {
    textQuery: `${CATEGORY_QUERY[category]} in ${city}`,
    pageSize,
  };
  if (pageToken) requestBody.pageToken = pageToken;

  let response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    response = await fetch(GOOGLE_PLACES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.types,places.businessStatus,places.googleMapsUri,places.websiteUri,places.nationalPhoneNumber,places.rating,places.userRatingCount,nextPageToken',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err) {
    console.warn(`[google-places] search failed city=${city} category=${category} reason=network`);
    throw new GooglePlacesError('Google Places service is unavailable', 503, 'network_error');
  }

  if (!response.ok) {
    let googleMessage = '';
    try {
      const errorBody = await response.json();
      googleMessage = errorBody?.error?.message || errorBody?.message || '';
    } catch {
      googleMessage = '';
    }

    if (response.status === 401 || response.status === 403) {
      console.warn(`[google-places] search failed city=${city} category=${category} status=${response.status}`);
      throw new GooglePlacesError('Google Places API key is invalid or not authorized', 403, 'invalid_api_key');
    }
    if (response.status === 429) {
      console.warn(`[google-places] search failed city=${city} category=${category} status=429 quota`);
      throw new GooglePlacesError('Google Places quota exceeded', 429, 'quota_exceeded');
    }
    console.warn(`[google-places] search failed city=${city} category=${category} status=${response.status}`);
    throw new GooglePlacesError(
      googleMessage ? `Google Places request failed: ${googleMessage}` : `Google Places request failed (HTTP ${response.status})`,
      502,
      'api_error'
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new GooglePlacesError('Google Places returned an invalid response', 502, 'invalid_response');
  }

  const places = Array.isArray(payload.places) ? payload.places : [];
  const results = places
    .filter((place) => place && place.id)
    .map((place) => normalizePlace(place, category));

  console.info(
    `[google-places] search city=${city} category=${category} results=${results.length} duration_ms=${Date.now() - startedAt}`
  );

  return {
    query: {
      city,
      category,
      page_size: pageSize,
      page_token: pageToken,
    },
    results,
    next_page_token: payload.nextPageToken ? String(payload.nextPageToken) : null,
    attribution: ATTRIBUTION,
    storage_policy: STORAGE_POLICY,
    configured: true,
  };
}

export { GooglePlacesError };
export default {
  getGooglePlacesConfig,
  validateSearchInput,
  searchGooglePlaces,
  GOOGLE_PLACES_CATEGORIES,
  GooglePlacesError,
};
