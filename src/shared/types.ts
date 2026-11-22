/**
 * SIPZY Marketing Bot - Shared Types & Constants
 *
 * Shared between the frontend and backend so both agree on:
 * - Lead / enquiry / activity / product shapes
 * - Dashboard statistics shapes
 * - API request/response shapes
 */

// ---------------------------------------------------------------------------
// Business Leads
// ---------------------------------------------------------------------------
export type LeadQualification = 'high' | 'medium' | 'low' | 'not_reviewed';

export type VerificationStatus = 'unverified' | 'pending_review' | 'verified' | 'rejected';
export type BusinessActive = boolean | null;

export type LeadQualityLabel = 'High' | 'Medium' | 'Low';

export interface LeadQuality {
  score: number;
  label: LeadQualityLabel;
  reasons: string[];
  suppressed: boolean;
  duplicate: boolean;
  outreach_ready: boolean;
}

export type GooglePlacesCategory =
  | 'Cafés'
  | 'Juice shops'
  | 'Bubble tea'
  | 'Restaurants'
  | 'QSRs'
  | 'Beverage chains'
  | 'Cloud kitchens';

export interface GooglePlaceCrmMatch {
  existing_lead_ids: string[];
  suppressed: boolean;
  suppression_ids: string[];
}

export interface GooglePlaceResult {
  place_id: string;
  name: string;
  category: GooglePlacesCategory;
  google_types: string[];
  business_status: string | null;
  address: string;
  phone: string;
  website: string;
  rating: number | null;
  user_rating_count: number | null;
  google_maps_url: string;
  attribution: string;
  saved_to_crm: false;
  crm_matches: GooglePlaceCrmMatch;
}

export interface GooglePlacesSearchResponse {
  query: {
    city: string;
    category: GooglePlacesCategory;
    page_size: number;
    page_token: string | null;
  };
  results: GooglePlaceResult[];
  next_page_token: string | null;
  attribution: string;
  storage_policy: {
    place_ids: string;
    other_fields: string;
  };
  configured: boolean;
}

export interface GooglePlacesConfig {
  configured: boolean;
  provider: string;
  endpoint: string;
  default_city: string;
  categories: GooglePlacesCategory[];
  max_results: number;
  attribution: string;
  storage_policy: {
    place_ids: string;
    other_fields: string;
  };
}

export const BUSINESS_CATEGORIES = [
  'Cafés and coffee shops',
  'Juice and smoothie shops',
  'Bubble tea outlets',
  'Restaurants',
  'QSRs',
  'Beverage chains',
  'Cloud kitchens',
] as const;

export const LEAD_QUALIFICATIONS: LeadQualification[] = [
  'high',
  'medium',
  'low',
  'not_reviewed',
];

export interface Lead {
  id: string;
  business_name: string;
  business_cat: string;
  lead_qualification: LeadQualification;
  verification_status: VerificationStatus;
  website_verified: boolean;
  phone_verified: boolean;
  address_verified: boolean;
  business_active: BusinessActive;
  verification_source: string;
  verification_notes: string;
  last_verified_at: string | null;
  verified_by: string;
  quality_score?: number;
  quality_label?: LeadQualityLabel;
  quality_reasons?: string[];
  contact_person: string;
  email: string;
  phone: string;
  city: string;
  address: string;
  website: string;
  lead_source: string;
  permission_notes: string;
  outreach_status: 'new' | 'contacted' | 'quoted' | 'won' | 'lost';
  created_at: string;
  /** List responses flag contacts that must never be approached. */
  suppressed?: boolean;
  suppression_reason?: string | null;
  suppression_id?: string | null;
}

// ---------------------------------------------------------------------------
// Enquiries
// ---------------------------------------------------------------------------
export type EnquiryStatus =
  | 'new'                  // New enquiry
  | 'interest-requested'   // Interested reply
  | 'more-info-requested'  // More information requested
  | 'quote-requested'      // Quote requested
  | 'quotation-sent'       // Quotation sent
  | 'sample-requested'     // Sample requested
  | 'negotiation'          // Negotiation
  | 'confirmed-order'      // Confirmed order
  | 'not-interested'       // Not interested
  | 'opted-out';           // Customer opted out

export type ProductType = 'Hot' | 'Cold';
export type CupSize = '250ml' | '350ml' | '500ml';

export interface Enquiry {
  id: string;
  lead_id: string;
  customer_name: string;
  business_name: string;
  phone: string;
  email: string;
  product_type: ProductType;
  cup_size: CupSize;
  quantity: number;
  delivery_location: string;
  enquiry_status: EnquiryStatus;
  original_message: string;
  ai_summary: string | null;
  follow_up_date: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Outreach Activity
// ---------------------------------------------------------------------------
export type Channel = 'email' | 'whatsapp' | 'manual';
export type ActivityType = 'call' | 'email' | 'message' | 'meeting' | 'follow_up' | 'demo';
export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'failed';

export interface Activity {
  id: string;
  lead_id: string;
  /** Business name of the linked lead (joined server-side). */
  business_name?: string;
  channel: Channel;
  activity_type: ActivityType;
  message_ref: string;
  delivery_status: DeliveryStatus;
  activity_date: string;
  notes: string;
}

// ---------------------------------------------------------------------------
// Product Catalogue
// ---------------------------------------------------------------------------
export interface Product {
  id: string;
  product_type: ProductType;
  cup_size: CupSize;
  description: string;
  active: 0 | 1;
}

// ---------------------------------------------------------------------------
// Message Analyzer (local rule-based parser)
// ---------------------------------------------------------------------------
export type AnalysisIntent =
  | 'interested'
  | 'quote_requested'
  | 'sample_requested'
  | 'more_information_requested'
  | 'follow_up_requested'
  | 'not_interested'
  | 'opted_out'
  | 'general_enquiry'
  | 'unknown';

export type MissingField =
  | 'customer_name'
  | 'business_name'
  | 'product_type'
  | 'cup_size'
  | 'quantity'
  | 'delivery_location';

export interface MessageAnalysis {
  customer_name: string | null;
  business_name: string | null;
  product_type: ProductType | null;
  cup_size: CupSize | null;
  quantity: number | null;
  delivery_location: string | null;
  intent: AnalysisIntent;
  intent_label: string;
  detected_intents: AnalysisIntent[];
  missing_information: MissingField[];
  missing_labels: string[];
  suggested_next_action: string;
  summary: string;
  original_message: string;
  parser: string;
  notes: string[];
}

/** Result of POST /enquiries/from-message. */
export interface MessageEnquiryResult {
  enquiry: Enquiry;
  analysis: MessageAnalysis;
  suppression?: { suppression: ContactSuppression; created: boolean } | null;
}

// ---------------------------------------------------------------------------
// Contact Suppressions (permanent do-not-contact registry)
// ---------------------------------------------------------------------------
export interface ContactSuppression {
  id: string;
  /** `phone:<digits>` / `email:<address>` / `enquiry:<id>` dedupe key. */
  contact_key: string;
  phone: string;
  email: string;
  customer_name: string;
  business_name: string;
  reason: string;
  source_message: string;
  enquiry_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Result of GET /suppressions/check. */
export interface OutreachCheck {
  allowed: boolean;
  reason: string | null;
  suppression: ContactSuppression | null;
  lead_id?: string;
  business_name?: string;
}

// ---------------------------------------------------------------------------
// Dashboard Statistics
// ---------------------------------------------------------------------------
export interface DashboardStats {
  totalLeads: number;
  totalEnquiries: number;
  newEnquiries: number;
  interestedCustomers: number;
  quoteRequests: number;
  confirmedOrders: number;
  suppressedContacts: number;
  outreachReadyLeads: number;
}

// ---------------------------------------------------------------------------
// API Response wrapper (used by every endpoint)
// ---------------------------------------------------------------------------
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
