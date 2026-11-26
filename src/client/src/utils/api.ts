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
    res = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...init });
  } catch {
    throw new ApiError('Could not reach the server. Is the backend running?', 0);
  }

  const body = await res.json().catch(() => null);

  if (res.status === 401) {
    // Session expired or was revoked: let the auth provider redirect.
    window.dispatchEvent(new CustomEvent('sipzy:unauthorized'));
    throw new ApiError('Your session has expired. Please sign in again.', 401);
  }

  if (!res.ok || !body || body.success === false) {
    throw new ApiError(body?.error || `Request failed (HTTP ${res.status})`, res.status);
  }

  return body.data as T;
}

function jsonInit(method: 'POST' | 'PATCH' | 'PUT', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// ---------------------------------------------------------------------------
// Authentication / session
// ---------------------------------------------------------------------------
export type Role = 'admin' | 'sales' | 'viewer';

/** Session user. Password hashes and session tokens are never returned. */
export interface SessionUser {
  id: string;
  username: string;
  email?: string;
  role: Role;
}

export interface LoginResult {
  user: SessionUser;
  expires_at: string;
}

export const authApi = {
  me: () => request<SessionUser>('/auth/me'),
  login: (username: string, password: string) =>
    request<LoginResult>('/auth/login', jsonInit('POST', { username, password })),
  logout: () => request<{ logged_out: boolean }>('/auth/logout', jsonInit('POST', {})),
  setup: (input: { username: string; password: string; email?: string }) =>
    request<LoginResult>('/auth/setup', jsonInit('POST', input)),
  users: () => request<SessionUser[]>('/auth/users'),
  createUser: (input: { username: string; password: string; email?: string; role: Role }) =>
    request<SessionUser>('/auth/users', jsonInit('POST', input)),
  updateRole: (id: string, role: Role) =>
    request<SessionUser>(`/auth/users/${id}/role`, jsonInit('PATCH', { role })),
  disableUser: (id: string, disabled: boolean) =>
    request<SessionUser>(`/auth/users/${id}/disable`, jsonInit('POST', { disabled })),
  auditLogs: () => request<any[]>('/auth/audit-logs'),
};

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

export const outreachApi = {
  compose: (leadId: string) =>
    request<{
      lead: Lead;
      allowed: boolean;
      reason?: string | null;
      message?: string | null;
      wa_link?: string | null;
    }>('/outreach/compose', jsonInit('POST', { lead_id: leadId })),
  record: (input: {
    lead_id: string;
    message: string;
    notes?: string;
    delivery_status?: string;
    activity_type?: string;
  }) => request<Activity>('/outreach/record', jsonInit('POST', input)),
  activity: (leadId: string) => request<Activity[]>('/outreach/activity?lead_id=' + encodeURIComponent(leadId)),
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

export const whatsappApi = {
  status: () => request<any>('/whatsapp/status'),
  messages: (params?: Query) => request<any[]>(`/whatsapp/messages${toQuery(params)}`),
  get: (id: string) => request<any>(`/whatsapp/messages/${id}`),
  update: (id: string, patch: any) => request<any>(`/whatsapp/messages/${id}`, jsonInit('PATCH', patch)),
  testNumber: (phone?: string) => request<any>('/whatsapp/test-number', jsonInit('POST', { phone })),
  send: (input: any) => request<any>('/whatsapp/send', jsonInit('POST', input)),
  simulateInbound: (input: { phone: string; body: string; contact_name?: string; external_id?: string }) =>
    request<any>('/whatsapp/simulate-inbound', jsonInit('POST', input)),
};

export const googlePlacesApi = {
  config: () => request<GooglePlacesConfig>('/google-places/config'),
  search: (params: {
    city?: string;
    area?: string;
    category?: string;
    page_size?: number;
    page_token?: string | null;
  }) => request<GooglePlacesSearchResponse>('/google-places/search', jsonInit('POST', params)),
  save: (params: {
    place_id: string;
    decision?: string;
    business_name?: string;
    business_cat?: string;
    contact_person?: string;
    email?: string;
    phone?: string;
    city?: string;
    address?: string;
    website?: string;
    permission_notes?: string;
  }) => request<any>('/google-places/save', jsonInit('POST', params)),
};

export const campaignsApi = {
  list: (params?: Query) => request<any[]>(`/campaigns${toQuery(params)}`),
  get: (id: string) => request<any>(`/campaigns/${id}`),
  create: (input: any) => request<any>('/campaigns', jsonInit('POST', input)),
  update: (id: string, patch: any) => request<any>(`/campaigns/${id}`, jsonInit('PATCH', patch)),
  remove: (id: string) => request<any>(`/campaigns/${id}`, { method: 'DELETE' }),
  pause: (id: string) => request<any>(`/campaigns/${id}/pause`, jsonInit('POST', {})),
  resume: (id: string) => request<any>(`/campaigns/${id}/resume`, jsonInit('POST', {})),
  archive: (id: string) => request<any>(`/campaigns/${id}/archive`, jsonInit('POST', {})),
  leads: (id: string) => request<any[]>(`/campaigns/${id}/leads`),
  addLeads: (id: string, input: any) => request<any>(`/campaigns/${id}/leads`, jsonInit('POST', input)),
  removeLead: (id: string, leadId: string) => request<any>(`/campaigns/${id}/leads/${leadId}`, { method: 'DELETE' }),
  enqueue: (id: string, input?: any) => request<any>(`/campaigns/${id}/enqueue`, jsonInit('POST', input || {})),
  stats: (id: string) => request<any>(`/campaigns/${id}/stats`),
  preview: (input: any) => request<any>('/campaigns/preview', jsonInit('POST', input)),
};

export const templatesApi = {
  list: (params?: Query) => request<any[]>(`/campaigns/templates${toQuery(params)}`),
  get: (id: string) => request<any>(`/campaigns/templates/${id}`),
  create: (input: any) => request<any>('/campaigns/templates', jsonInit('POST', input)),
  update: (id: string, patch: any) => request<any>(`/campaigns/templates/${id}`, jsonInit('PATCH', patch)),
  remove: (id: string) => request<any>(`/campaigns/templates/${id}`, { method: 'DELETE' }),
};

export const queueApi = {
  list: (params?: Query) => request<any[]>(`/campaigns/queue${toQuery(params)}`),
  process: (input?: any) => request<any>('/campaigns/queue/process', jsonInit('POST', input || {})),
  cancel: (id: string, reason?: string) => request<any>(`/campaigns/queue/${id}/cancel`, jsonInit('POST', { reason })),
  retry: (id: string) => request<any>(`/campaigns/queue/${id}/retry`, jsonInit('POST', {})),
};

export const campaignSettingsApi = {
  get: () => request<any>('/campaigns/settings'),
  update: (patch: any) => request<any>('/campaigns/settings', jsonInit('PATCH', patch)),
};

export const testCampaignApi = {
  get: () => request<any>('/test-campaign'),
  activity: (limit?: number) => request<any[]>(`/test-campaign/activity${toQuery({ limit })}`),
  upsertContact: (input: any) => request<any>('/test-campaign/contacts', jsonInit('POST', input)),
  authorize: (id: string, authorized: boolean) =>
    request<any>(`/test-campaign/contacts/${id}`, jsonInit('PATCH', { authorized })),
  removeContact: (id: string) => request<any>(`/test-campaign/contacts/${id}`, { method: 'DELETE' }),
  start: (input?: any) => request<any>('/test-campaign/start', jsonInit('POST', input || {})),
  stop: () => request<any>('/test-campaign/stop', jsonInit('POST', {})),
};

export const conversationsApi = {
  list: (params?: Query) => request<any[]>(`/conversations${toQuery(params)}`),
  get: (id: string) => request<any>(`/conversations/${id}`),
  update: (id: string, patch: any) => request<any>(`/conversations/${id}`, jsonInit('PATCH', patch)),
  approve: (id: string, approvedBy?: string) => request<any>(`/conversations/${id}/approve`, jsonInit('POST', { approved_by: approvedBy })),
  reject: (id: string, note?: string) => request<any>(`/conversations/${id}/reject`, jsonInit('POST', { note })),
  regenerate: (id: string) => request<any>(`/conversations/${id}/regenerate`, jsonInit('POST', {})),
  processInbound: (input: any) => request<any>('/conversations/process-inbound', jsonInit('POST', input)),
};

export const api = {
  auth: authApi,
  leads: leadsApi,
  enquiries: enquiriesApi,
  products: productsApi,
  activity: activityApi,
  analyzer: analyzerApi,
  suppressions: suppressionsApi,
  stats: statsApi,
  googlePlaces: googlePlacesApi,
  whatsapp: whatsappApi,
  campaigns: campaignsApi,
  testCampaign: testCampaignApi,
  templates: templatesApi,
  conversations: conversationsApi,
  handoffs: {
    list: (params?: Query) => request<any[]>(`/handoffs${toQuery(params)}`),
    get: (id: string) => request<any>(`/handoffs/${id}`),
    create: (input: any) => request<any>('/handoffs', jsonInit('POST', input)),
    update: (id: string, patch: any) => request<any>(`/handoffs/${id}`, jsonInit('PATCH', patch)),
  },
  quotations: {
    list: (params?: Query) => request<any[]>(`/quotations${toQuery(params)}`),
    get: (id: string) => request<any>(`/quotations/${id}`),
    create: (input: any) => request<any>('/quotations', jsonInit('POST', input)),
    update: (id: string, patch: any) => request<any>(`/quotations/${id}`, jsonInit('PATCH', patch)),
  },
  orders: {
    list: (params?: Query) => request<any[]>(`/orders${toQuery(params)}`),
    get: (id: string) => request<any>(`/orders/${id}`),
    create: (input: any) => request<any>('/orders', jsonInit('POST', input)),
    update: (id: string, patch: any) => request<any>(`/orders/${id}`, jsonInit('PATCH', patch)),
  },
  salesWorkflow: {
    scenarios: () => request<any[]>('/sales-workflow/scenarios'),
    funnel: () => request<any>('/sales-workflow/funnel'),
    simulate: (input: any) => request<any>('/sales-workflow/simulate', jsonInit('POST', input)),
    runScenario: (scenario: string, options?: any) => request<any>('/sales-workflow/simulate-scenario', jsonInit('POST', { scenario, ...options })),
  },
  queue: queueApi,
  campaignSettings: campaignSettingsApi,
};

export default api;
