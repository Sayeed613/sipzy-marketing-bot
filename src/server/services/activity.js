import { getDb } from '../db/index.js';
import { randomUUID } from 'node:crypto';

const db = getDb();

const VALID_CHANNELS = ['email', 'whatsapp', 'manual'];
const VALID_STATUSES = ['pending', 'sent', 'delivered', 'failed'];
const VALID_TYPES = ['call', 'email', 'message', 'meeting', 'follow_up', 'demo'];

function validateInput(input) {
  const errors = [];
  const data = {};
  if (input === undefined || input === null) {
    errors.push({ field: 'body', message: 'Request body is required' });
    return { errors, data };
  }
  if (input.lead_id !== undefined && input.lead_id !== null) {
    const v = String(input.lead_id).trim();
    if (v === '') errors.push({ field: 'lead_id', message: 'lead_id must not be empty' });
    data.lead_id = v;
  }
  if (input.channel !== undefined && input.channel !== null) {
    if (!VALID_CHANNELS.includes(String(input.channel))) {
      errors.push({ field: 'channel', message: `channel must be one of: ${VALID_CHANNELS.join(', ')}` });
    }
    data.channel = String(input.channel);
  }
  if (input.activity_type !== undefined && input.activity_type !== null) {
    if (!VALID_TYPES.includes(String(input.activity_type))) {
      errors.push({ field: 'activity_type', message: `activity_type must be one of: ${VALID_TYPES.join(', ')}` });
    }
    data.activity_type = String(input.activity_type);
  }
  if (input.message_ref !== undefined && input.message_ref !== null) {
    data.message_ref = String(input.message_ref).trim();
  }
  if (input.delivery_status !== undefined && input.delivery_status !== null) {
    if (!VALID_STATUSES.includes(String(input.delivery_status))) {
      errors.push({ field: 'delivery_status', message: `delivery_status must be one of: ${VALID_STATUSES.join(', ')}` });
    }
    data.delivery_status = String(input.delivery_status);
  }
  if (input.activity_date !== undefined && input.activity_date !== null) {
    data.activity_date = String(input.activity_date).trim();
  }
  if (input.notes !== undefined && input.notes !== null) {
    data.notes = String(input.notes).trim();
  }
  return { errors, data };
}

function createActivity(input) {
  const { errors, data } = validateInput(input);
  if (errors.length) throw new Error(errors.map((e) => e.message).join('; '));

  const id = randomUUID();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO activity (id, lead_id, channel, activity_type, message_ref, delivery_status, activity_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, data.lead_id || '', data.channel || '', data.activity_type || '', data.message_ref || '', data.delivery_status || 'pending', data.activity_date || now, data.notes || '');

  return readActivity(id);
}

const SELECT_WITH_LEAD = `
  SELECT a.*, COALESCE(l.business_name, '') AS business_name
  FROM activity a
  LEFT JOIN leads l ON l.id = a.lead_id
`;

function readActivity(id) {
  return db.prepare(`${SELECT_WITH_LEAD} WHERE a.id = ?`).get(id) || null;
}

function listActivity(filters = {}) {
  const { leadId, channel, status } = filters;
  let sql = SELECT_WITH_LEAD;
  const params = [];
  const conditions = [];
  if (leadId) {
    conditions.push('a.lead_id = ?');
    params.push(leadId);
  }
  if (channel) {
    conditions.push('a.channel = ?');
    params.push(channel);
  }
  if (status) {
    conditions.push('a.delivery_status = ?');
    params.push(status);
  }
  if (conditions.length) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY a.activity_date DESC';
  return db.prepare(sql).all(...params);
}

function deleteActivity(id) {
  return db.prepare('DELETE FROM activity WHERE id = ?').run(id).changes > 0;
}

export { createActivity, readActivity, listActivity, deleteActivity, validateInput };
