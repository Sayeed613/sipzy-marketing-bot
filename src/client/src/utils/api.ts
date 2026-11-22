/**
 * SIPZY Marketing Bot — Frontend API Service
 *
 * Single place where the dashboard talks to the Express backend.
 * Requests go to `/api/v1`, which Vite proxies to the server in dev
 * and which is served same-origin in production.
 *
 * Every call resolves with the payload from `{ success, data }` and
 * throws an `ApiError` carrying the backend's message on failure.
 */

import type {
  Activity,
  AnalysisIntent,
  ContactSuppression,
  DashboardStats,
  Enquiry,
  GooglePlaceResult,
  GooglePlacesConfig,
  GooglePlacesSearchResponse,
  Lead,
  MessageAnalysis,
  MessageEnquiryResult,
  MissingField,
  OutreachCheck,
  Product,
} from '../../../shared/types';

export type {
  Activity,
  AnalysisIntent,
  ContactSuppression,
  DashboardStats,
  Enquiry,
  GooglePlaceResult,
  GooglePlacesConfig,
  GooglePlacesSearchResponse,
  Lead,
  MessageAnalysis,
  MessageEnquiryResult,
  MissingField,
  OutreachCheck,
  Product,
};
export type EnquiryStatus = Enquiry['enquiry_status'];
export type OutreachStatus = Lead['outreach_status'];

/** Fields the reviewer may correct before saving an analysed enquiry. */
export interface ReviewedEnquiryInput {
  message: string;
  lead_id?: string;
  customer_name?: string;
  business_name?: string;
  phone?: string;
  email?: string;
  product_type?: Enquiry['product_type'] | '';
  cup_size?: Enquiry['cup_size'] | '';
  quantity?: number | null;
  delivery_location?: string;
  enquiry_status?: Enquiry['enquiry_status'];
}

const API_BASE = '/api/v1';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

function toQuery(params: Query = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError('Could not reach the server. Is the backend running?', 0);
  }

  const body = await res.json().catch(() => null);

  if (!res.ok || !body || body.success === false) {
    throw new ApiError(body?.error || `Request failed (HTTP ${res.status})`, res.status);
  }

  return body.data as T;
}

function jsonInit(method: 'POST' | 'PATCH', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------
export const leadsApi = {
  list: (params?: Query) => request<Lead[]>(`/leads${toQuery(params)}`),
  get: (id: string) => request<Lead>(`/leads/${id}`),
  create: (input: Partial<Lead>) => request<Lead>('/leads', jsonInit('POST', input)),
  update: (id: string, patch: Partial<Lead>) =>
    request<Lead>(`/leads/${id}`, jsonInit('PATCH', patch)),
  remove: (id: string) => request<{ id: string; deleted: boolean }>(`/leads/${id}`, { method: 'DELETE' }),
  importCsv: (csv: string) =>
    request<{ total: number; imported: number; skipped: number; errors: { row: number; message: string }[]; created: string[] }>(
      '/leads/import',
      jsonInit('POST', { csv }),
    ),
  duplicates: () =>
    request<{ key: string; reason: string; leads: Lead[] }[]>('/leads/duplicates'),
  exportUrl: (params?: Query) => `/api/v1/leads/export${toQuery(params)}`,
};

// ---------------------------------------------------------------------------
// Enquiries
// ---------------------------------------------------------------------------
export const enquiriesApi = {
  list: (params?: Query) => request<Enquiry[]>(`/enquiries${toQuery(params)}`),
  get: (id: string) => request<Enquiry>(`/enquiries/${id}`),
  create: (input: Partial<Enquiry>) => request<Enquiry>('/enquiries', jsonInit('POST', input)),
  update: (id: string, patch: Partial<Enquiry>) =>
    request<Enquiry>(`/enquiries/${id}`, jsonInit('PATCH', patch)),
  updateStatus: (id: string, status: Enquiry['enquiry_status']) =>
    request<Enquiry>(`/enquiries/${id}`, jsonInit('PATCH', { enquiry_status: status })),
  remove: (id: string) =>
    request<{ id: string; deleted: boolean }>(`/enquiries/${id}`, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Product catalogue
// ---------------------------------------------------------------------------
export const productsApi = {
  list: (params?: Query) => request<Product[]>(`/products${toQuery(params)}`),
};

// ---------------------------------------------------------------------------
// Outreach activity
// ---------------------------------------------------------------------------
export const activityApi = {
  list: (params?: Query) => request<Activity[]>(`/activity${toQuery(params)}`),
  create: (input: Partial<Activity>) => request<Activity>('/activity', jsonInit('POST', input)),
  remove: (id: string) =>
    request<{ id: string; deleted: boolean }>(`/activity/${id}`, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Message analyzer (local rules — no external AI service)
// ---------------------------------------------------------------------------
export const analyzerApi = {
  analyze: (message: string) =>
    request<MessageAnalysis>('/analyze-message', jsonInit('POST', { message })),
  saveFromMessage: (input: ReviewedEnquiryInput) =>
    request<MessageEnquiryResult>(
      '/enquiries/from-message',
      jsonInit('POST', { ...input, quantity: input.quantity ?? null }),
    ),
};

// ---------------------------------------------------------------------------
// Contact suppressions (read-only: no delete is exposed by the backend)
// ---------------------------------------------------------------------------
export const suppressionsApi = {
  list: (params?: Query) => request<ContactSuppression[]>(`/suppressions${toQuery(params)}`),
  check: (params: { phone?: string; email?: string; lead_id?: string }) =>
    request<OutreachCheck>(`/suppressions/check${toQuery(params)}`),
};

// ---------------------------------------------------------------------------
// Dashboard statistics
// ---------------------------------------------------------------------------
export const statsApi = {
  get: () => request<DashboardStats>('/dashboard-stats'),
};

export const googlePlacesApi = {
  config: () => request<GooglePlacesConfig>('/google-places/config'),
  search: (params: {
    city?: string;
    category?: string;
    page_size?: number;
    page_token?: string | null;
  }) => request<GooglePlacesSearchResponse>('/google-places/search', jsonInit('POST', params)),
};

export const api = {
  leads: leadsApi,
  enquiries: enquiriesApi,
  products: productsApi,
  activity: activityApi,
  analyzer: analyzerApi,
  suppressions: suppressionsApi,
  stats: statsApi,
  googlePlaces: googlePlacesApi,
};

export default api;
