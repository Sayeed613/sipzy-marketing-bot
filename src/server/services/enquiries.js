import { getDb } from '../db/index.js';
import { randomUUID } from 'node:crypto';
import { registerOptOut } from './suppressions.js';

const db = getDb();

const VALID_STATUSES = [
  'new',
  'interest-requested',
  'more-info-requested',
  'quote-requested',
  'quotation-sent',
  'sample-requested',
  'negotiation',
  'confirmed-order',
  'not-interested',
  'opted-out',
];
const VALID_PRODUCT_TYPES = ['Hot', 'Cold'];
const VALID_CUP_SIZES = ['250ml', '350ml', '500ml'];

/**
 * Build a validated + cleaned enquiry object from raw input.
 * Returns { errors, data }.
 */
function validateEnquiry(input) {
  const errors = [];
  const data = {};

  if (input === undefined || input === null) {
    errors.push({ field: 'body', message: 'Request body is required' });
    return { errors, data };
  }

  // lead_id - optional
  if (input.lead_id !== undefined && input.lead_id !== null) {
    const leadId = String(input.lead_id).trim();
    if (leadId === '') {
      errors.push({ field: 'lead_id', message: 'lead_id must not be empty if provided' });
    }
    data.lead_id = leadId;
  }

  // customer_name - optional but useful
  if (input.customer_name !== undefined && input.customer_name !== null) {
    data.customer_name = String(input.customer_name).trim();
  }

  // business_name - optional
  if (input.business_name !== undefined && input.business_name !== null) {
    data.business_name = String(input.business_name).trim();
  }

  // phone
  if (input.phone !== undefined && input.phone !== null) {
    data.phone = String(input.phone).trim();
  }

  // email - optional but validate if present
  if (input.email !== undefined && input.email !== null) {
    const email = String(input.email).trim();
    if (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push({ field: 'email', message: 'Email must be a valid email address' });
    }
    data.email = email;
  }

  // product_type
  if (input.product_type !== undefined && input.product_type !== null) {
    const pt = String(input.product_type).trim();
    if (!VALID_PRODUCT_TYPES.includes(pt)) {
      errors.push({ field: 'product_type', message: `product_type must be one of: ${VALID_PRODUCT_TYPES.join(', ')}` });
    }
    data.product_type = pt;
  }

  // cup_size
  if (input.cup_size !== undefined && input.cup_size !== null) {
    const cs = String(input.cup_size).trim();
    if (!VALID_CUP_SIZES.includes(cs)) {
      errors.push({ field: 'cup_size', message: `cup_size must be one of: ${VALID_CUP_SIZES.join(', ')}` });
    }
    data.cup_size = cs;
  }

  // quantity
  if (input.quantity !== undefined && input.quantity !== null) {
    const q = Number(input.quantity);
    if (!Number.isInteger(q) || q < 0) {
      errors.push({ field: 'quantity', message: 'quantity must be a non-negative integer' });
    }
    data.quantity = q;
  }

  // delivery_location
  if (input.delivery_location !== undefined && input.delivery_location !== null) {
    data.delivery_location = String(input.delivery_location).trim();
  }

  // enquiry_status
  if (input.enquiry_status !== undefined && input.enquiry_status !== null) {
    const es = String(input.enquiry_status).trim();
    if (!VALID_STATUSES.includes(es)) {
      errors.push({ field: 'enquiry_status', message: `enquiry_status must be one of: ${VALID_STATUSES.join(', ')}` });
    }
    data.enquiry_status = es;
  }

  // original_message
  if (input.original_message !== undefined && input.original_message !== null) {
    data.original_message = String(input.original_message).trim();
  }

  // ai_summary - nullable
  if (input.ai_summary !== undefined && input.ai_summary !== null) {
    data.ai_summary = input.ai_summary === null ? null : String(input.ai_summary).trim();
  }

  // follow_up_date
  if (input.follow_up_date !== undefined && input.follow_up_date !== null) {
    data.follow_up_date = String(input.follow_up_date).trim();
  }

  // created_at / updated_at - defaulted
  data.created_at = new Date().toISOString();
  data.updated_at = data.created_at;

  return { errors, data };
}

/**
 * Insert an enquiry.
 * @param {Object} input
 * @returns {Object} the inserted enquiry row
 */
function createEnquiry(input) {
  const { errors, data } = validateEnquiry(input);
  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join('; '));
  }
  const db2 = getDb();
  const id = randomUUID();
  const stmt = db2.prepare(`
    INSERT INTO enquiries
      (id, lead_id, customer_name, business_name, phone, email, product_type,
       cup_size, quantity, delivery_location, enquiry_status, original_message,
       ai_summary, follow_up_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    data.lead_id || null,
    data.customer_name || '',
    data.business_name || '',
    data.phone || '',
    data.email || '',
    data.product_type || '',
    data.cup_size || '',
    data.quantity || 0,
    data.delivery_location || '',
    data.enquiry_status || 'new',
    data.original_message || '',
    data.ai_summary || null,
    data.follow_up_date || '',
    data.created_at,
    data.updated_at,
  );

  const saved = readEnquiry(id);
  registerSuppressionIfOptedOut(saved);
  return saved;
}

/**
 * An enquiry saved with status `opted-out` must also enter the permanent
 * suppression registry. Never throws away the enquiry: a registry failure
 * is surfaced so it can be fixed rather than silently ignored.
 * @param {Object|null} enquiry
 * @returns {{ suppression: Object, created: boolean } | null}
 */
function registerSuppressionIfOptedOut(enquiry) {
  if (!enquiry || enquiry.enquiry_status !== 'opted-out') return null;
  return registerOptOut({
    phone: enquiry.phone,
    email: enquiry.email,
    customer_name: enquiry.customer_name,
    business_name: enquiry.business_name,
    source_message: enquiry.original_message,
    enquiry_id: enquiry.id,
  });
}

/**
 * Read a single enquiry by id.
 * @param {string} id
 * @returns {Object|null}
 */
function readEnquiry(id) {
  const stmt = db.prepare('SELECT * FROM enquiries WHERE id = ?');
  return stmt.get(id) || null;
}

/**
 * List enquiries. Optional filters: leadId, status, productType, cupSize.
 * @param {Object} [filters]
 * @returns {Array}
 */
function listEnquiries(filters = {}) {
  const { leadId, status, productType, cupSize } = filters;
  let sql = 'SELECT * FROM enquiries';
  const params = [];
  const conditions = [];

  if (leadId) {
    conditions.push('lead_id = ?');
    params.push(leadId);
  }
  if (status) {
    conditions.push('enquiry_status = ?');
    params.push(status);
  }
  if (productType) {
    conditions.push('product_type = ?');
    params.push(productType);
  }
  if (cupSize) {
    conditions.push('cup_size = ?');
    params.push(cupSize);
  }

  if (conditions.length) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY updated_at DESC';

  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

/**
 * Update an enquiry (partial). Caller must have validated fields.
 * @param {string} id
 * @param {Object} patch
 * @returns {Object|null} the updated row or null
 */
function updateEnquiry(id, patch) {
  const existing = readEnquiry(id);
  if (!existing) return null;

  if (!patch || typeof patch !== 'object') {
    throw new Error('Request body is required');
  }

  // Re-validate the merged row so a patch can never store an invalid
  // status, product type, cup size, quantity or email address. Enquiries
  // saved without a product/size store ''; drop those keys from the merge
  // so the enum check only runs on values that actually exist.
  const merged = { ...existing, ...patch };
  if (merged.product_type === '') delete merged.product_type;
  if (merged.cup_size === '') delete merged.cup_size;
  const { errors, data } = validateEnquiry(merged);
  if (errors.length) {
    throw new Error(errors.map((e) => `${e.field}: ${e.message}`).join('; '));
  }

  // Build the SET clause and its parameters in the same order so the
  // placeholders can never drift out of sync.
  const fields = [];
  const params = [];
  const set = (column, value) => {
    fields.push(`${column} = ?`);
    params.push(value);
  };

  if (patch.customer_name !== undefined) set('customer_name', data.customer_name || '');
  if (patch.business_name !== undefined) set('business_name', data.business_name || '');
  if (patch.phone !== undefined) set('phone', data.phone || '');
  if (patch.email !== undefined) set('email', data.email || '');
  if (patch.product_type !== undefined) set('product_type', data.product_type || '');
  if (patch.cup_size !== undefined) set('cup_size', data.cup_size || '');
  if (patch.quantity !== undefined) set('quantity', data.quantity || 0);
  if (patch.delivery_location !== undefined) set('delivery_location', data.delivery_location || '');
  if (patch.enquiry_status !== undefined) set('enquiry_status', data.enquiry_status || 'new');
  if (patch.original_message !== undefined) set('original_message', data.original_message || '');
  if (patch.ai_summary !== undefined) set('ai_summary', data.ai_summary ?? null);
  if (patch.follow_up_date !== undefined) set('follow_up_date', data.follow_up_date || '');

  if (!fields.length) return existing;

  set('updated_at', new Date().toISOString());
  params.push(id);

  db.prepare(`UPDATE enquiries SET ${fields.join(', ')} WHERE id = ?`).run(...params);

  const updated = readEnquiry(id);
  // Moving a live enquiry to opted-out (or correcting the contact details of
  // an already opted-out one) must register/refresh the suppression record.
  registerSuppressionIfOptedOut(updated);
  return updated;
}

/**
 * Delete an enquiry by id.
 * @param {string} id
 * @returns {boolean} true if a row was deleted
 */
function deleteEnquiry(id) {
  const stmt = db.prepare('DELETE FROM enquiries WHERE id = ?');
  return stmt.run(id).changes > 0;
}

export {
  createEnquiry,
  readEnquiry,
  registerSuppressionIfOptedOut,
  listEnquiries,
  updateEnquiry,
  deleteEnquiry,
  validateEnquiry,
};
