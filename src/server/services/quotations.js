import crypto from 'node:crypto';
import { getDb } from '../db/index.js';

const db = () => getDb();

const VALID_STATUSES = ['draft', 'approved', 'sent', 'accepted', 'rejected'];
const VALID_PRODUCT_TYPES = ['Hot', 'Cold'];
const VALID_CUP_SIZES = ['250ml', '350ml', '450ml'];

function nowIso() { return new Date().toISOString(); }

function rowToQuotation(row) {
  if (!row) return null;
  return { ...row, unit_price: Number(row.unit_price || 0), delivery_charges: Number(row.delivery_charges || 0), total_price: Number(row.total_price || 0) };
}

export function validateQuotation(input) {
  const errors = [];
  const data = {};
  if (!input || typeof input !== 'object') { errors.push('Request body is required'); return { errors, data }; }
  if (input.enquiry_id !== undefined) data.enquiry_id = String(input.enquiry_id || '').trim() || null;
  if (input.conversation_id !== undefined) data.conversation_id = String(input.conversation_id || '').trim() || null;
  if (input.lead_id !== undefined) data.lead_id = String(input.lead_id || '').trim() || null;
  if (input.product_type !== undefined) {
    const pt = String(input.product_type).trim();
    if (pt && !VALID_PRODUCT_TYPES.includes(pt)) errors.push(`product_type must be one of: ${VALID_PRODUCT_TYPES.join(', ')}`);
    data.product_type = pt;
  }
  if (input.cup_size !== undefined) {
    const cs = String(input.cup_size).trim();
    if (cs && !VALID_CUP_SIZES.includes(cs)) errors.push(`cup_size must be one of: ${VALID_CUP_SIZES.join(', ')}`);
    data.cup_size = cs;
  }
  if (input.quantity !== undefined) {
    const q = Number(input.quantity);
    if (!Number.isInteger(q) || q < 0) errors.push('quantity must be a non-negative integer');
    data.quantity = q;
  }
  if (input.unit_price !== undefined) {
    const p = Number(input.unit_price);
    if (!Number.isFinite(p) || p < 0) errors.push('unit_price must be a non-negative number');
    data.unit_price = p;
  }
  if (input.delivery_charges !== undefined) {
    const d = Number(input.delivery_charges);
    if (!Number.isFinite(d) || d < 0) errors.push('delivery_charges must be a non-negative number');
    data.delivery_charges = d;
  }
  if (input.total_price !== undefined) {
    const t = Number(input.total_price);
    if (!Number.isFinite(t) || t < 0) errors.push('total_price must be a non-negative number');
    data.total_price = t;
  }
  if (input.validity_days !== undefined) {
    const v = Number(input.validity_days);
    if (!Number.isInteger(v) || v < 0) errors.push('validity_days must be a non-negative integer');
    data.validity_days = v;
  }
  if (input.valid_until !== undefined) data.valid_until = input.valid_until ? String(input.valid_until).trim() : null;
  if (input.status !== undefined) {
    const s = String(input.status).trim();
    if (!VALID_STATUSES.includes(s)) errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}`);
    data.status = s;
  }
  if (input.notes !== undefined) data.notes = String(input.notes || '').trim();
  return { errors, data };
}

export function createQuotation(input = {}) {
  const { errors, data } = validateQuotation(input);
  if (errors.length) throw new Error(errors.join('; '));
  const id = crypto.randomUUID();
  const now = nowIso();
  const quantity = data.quantity ?? 0;
  const unit = data.unit_price ?? 0;
  const delivery = data.delivery_charges ?? 0;
  const total = data.total_price !== undefined ? data.total_price : quantity * unit + delivery;
  const validity = data.validity_days ?? 7;
  const validUntil = data.valid_until || new Date(Date.now() + validity * 24 * 60 * 60 * 1000).toISOString();
  db().prepare(
    `INSERT INTO quotations
      (id, enquiry_id, conversation_id, lead_id, product_type, cup_size, quantity, unit_price,
       delivery_charges, total_price, validity_days, valid_until, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.enquiry_id || null,
    data.conversation_id || null,
    data.lead_id || null,
    data.product_type || '',
    data.cup_size || '',
    quantity,
    unit,
    delivery,
    total,
    validity,
    validUntil,
    data.status || 'draft',
    data.notes || '',
    now,
    now,
  );
  return readQuotation(id);
}

export function readQuotation(id) {
  return rowToQuotation(db().prepare('SELECT * FROM quotations WHERE id = ?').get(id));
}

export function listQuotations(filters = {}) {
  const conditions = [];
  const params = [];
  if (filters.status) { conditions.push('status = ?'); params.push(filters.status); }
  if (filters.enquiry_id) { conditions.push('enquiry_id = ?'); params.push(filters.enquiry_id); }
  if (filters.conversation_id) { conditions.push('conversation_id = ?'); params.push(filters.conversation_id); }
  let sql = 'SELECT * FROM quotations';
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY created_at DESC';
  if (filters.limit) { sql += ' LIMIT ?'; params.push(Number(filters.limit)); }
  return db().prepare(sql).all(...params).map(rowToQuotation);
}

export function updateQuotation(id, patch = {}) {
  const existing = readQuotation(id);
  if (!existing) return null;
  const { errors, data } = validateQuotation(patch);
  if (errors.length) throw new Error(errors.join('; '));
  const fields = [];
  const params = [];
  const set = (col, val) => { fields.push(`${col} = ?`); params.push(val); };
  if (data.enquiry_id !== undefined) set('enquiry_id', data.enquiry_id);
  if (data.conversation_id !== undefined) set('conversation_id', data.conversation_id);
  if (data.lead_id !== undefined) set('lead_id', data.lead_id);
  if (data.product_type !== undefined) set('product_type', data.product_type);
  if (data.cup_size !== undefined) set('cup_size', data.cup_size);
  if (data.quantity !== undefined) set('quantity', data.quantity);
  if (data.unit_price !== undefined) set('unit_price', data.unit_price);
  if (data.delivery_charges !== undefined) set('delivery_charges', data.delivery_charges);
  if (data.total_price !== undefined) set('total_price', data.total_price);
  if (data.validity_days !== undefined) set('validity_days', data.validity_days);
  if (data.valid_until !== undefined) set('valid_until', data.valid_until);
  if (data.status !== undefined) set('status', data.status);
  if (data.notes !== undefined) set('notes', data.notes);
  // Recompute total if price components changed but total not explicitly provided.
  if ((data.quantity !== undefined || data.unit_price !== undefined || data.delivery_charges !== undefined) && data.total_price === undefined) {
    const q = data.quantity ?? existing.quantity;
    const u = data.unit_price ?? existing.unit_price;
    const d = data.delivery_charges ?? existing.delivery_charges;
    set('total_price', q * u + d);
  }
  if (!fields.length) return existing;
  set('updated_at', nowIso());
  params.push(id);
  db().prepare(`UPDATE quotations SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return readQuotation(id);
}

export default { validateQuotation, createQuotation, readQuotation, listQuotations, updateQuotation };