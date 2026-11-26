import crypto from 'node:crypto';
import { getDb } from '../db/index.js';

const db = () => getDb();

const VALID_STATUSES = ['pending_confirmation', 'confirmed', 'production', 'dispatched', 'delivered', 'cancelled'];
const VALID_PRODUCT_TYPES = ['Hot', 'Cold'];
const VALID_CUP_SIZES = ['250ml', '350ml', '450ml'];

function nowIso() { return new Date().toISOString(); }

function rowToOrder(row) {
  if (!row) return null;
  return { ...row, quantity: Number(row.quantity || 0) };
}

export function validateOrder(input) {
  const errors = [];
  const data = {};
  if (!input || typeof input !== 'object') { errors.push('Request body is required'); return { errors, data }; }
  if (input.enquiry_id !== undefined) data.enquiry_id = String(input.enquiry_id || '').trim() || null;
  if (input.quotation_id !== undefined) data.quotation_id = String(input.quotation_id || '').trim() || null;
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
  if (input.status !== undefined) {
    const s = String(input.status).trim();
    if (!VALID_STATUSES.includes(s)) errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}`);
    data.status = s;
  }
  if (input.notes !== undefined) data.notes = String(input.notes || '').trim();
  if (input.confirmed_at !== undefined) data.confirmed_at = input.confirmed_at ? String(input.confirmed_at).trim() : null;
  return { errors, data };
}

export function createOrder(input = {}) {
  const { errors, data } = validateOrder(input);
  if (errors.length) throw new Error(errors.join('; '));
  const id = crypto.randomUUID();
  const now = nowIso();
  const status = data.status || 'pending_confirmation';
  const confirmedAt = status === 'confirmed' ? (data.confirmed_at || now) : (data.confirmed_at || null);
  db().prepare(
    `INSERT INTO orders
      (id, enquiry_id, quotation_id, conversation_id, lead_id, product_type, cup_size, quantity,
       status, notes, confirmed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.enquiry_id || null,
    data.quotation_id || null,
    data.conversation_id || null,
    data.lead_id || null,
    data.product_type || '',
    data.cup_size || '',
    data.quantity || 0,
    status,
    data.notes || '',
    confirmedAt,
    now,
    now,
  );
  return readOrder(id);
}

export function readOrder(id) {
  return rowToOrder(db().prepare('SELECT * FROM orders WHERE id = ?').get(id));
}

export function listOrders(filters = {}) {
  const conditions = [];
  const params = [];
  if (filters.status) { conditions.push('status = ?'); params.push(filters.status); }
  if (filters.enquiry_id) { conditions.push('enquiry_id = ?'); params.push(filters.enquiry_id); }
  if (filters.quotation_id) { conditions.push('quotation_id = ?'); params.push(filters.quotation_id); }
  if (filters.conversation_id) { conditions.push('conversation_id = ?'); params.push(filters.conversation_id); }
  let sql = 'SELECT * FROM orders';
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY created_at DESC';
  if (filters.limit) { sql += ' LIMIT ?'; params.push(Number(filters.limit)); }
  return db().prepare(sql).all(...params).map(rowToOrder);
}

export function updateOrder(id, patch = {}) {
  const existing = readOrder(id);
  if (!existing) return null;
  const { errors, data } = validateOrder(patch);
  if (errors.length) throw new Error(errors.join('; '));
  const fields = [];
  const params = [];
  const set = (col, val) => { fields.push(`${col} = ?`); params.push(val); };
  if (data.enquiry_id !== undefined) set('enquiry_id', data.enquiry_id);
  if (data.quotation_id !== undefined) set('quotation_id', data.quotation_id);
  if (data.conversation_id !== undefined) set('conversation_id', data.conversation_id);
  if (data.lead_id !== undefined) set('lead_id', data.lead_id);
  if (data.product_type !== undefined) set('product_type', data.product_type);
  if (data.cup_size !== undefined) set('cup_size', data.cup_size);
  if (data.quantity !== undefined) set('quantity', data.quantity);
  if (data.notes !== undefined) set('notes', data.notes);
  if (data.status !== undefined) {
    set('status', data.status);
    if (data.status === 'confirmed' && !existing.confirmed_at && !data.confirmed_at) {
      set('confirmed_at', nowIso());
    }
  }
  if (data.confirmed_at !== undefined) set('confirmed_at', data.confirmed_at);
  if (!fields.length) return existing;
  set('updated_at', nowIso());
  params.push(id);
  db().prepare(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return readOrder(id);
}

export function countConfirmedOrders() {
  return db().prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('confirmed','production','dispatched','delivered')").get().n;
}

export default { validateOrder, createOrder, readOrder, listOrders, updateOrder, countConfirmedOrders };