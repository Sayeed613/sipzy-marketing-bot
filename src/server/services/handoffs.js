import crypto from 'node:crypto';
import { getDb } from '../db/index.js';

const db = () => getDb();

const VALID_STATUSES = ['open', 'in_progress', 'completed', 'cancelled'];
const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

function nowIso() { return new Date().toISOString(); }
function parseJson(v, f) { try { return v ? JSON.parse(v) : f; } catch { return f; } }

function rowToTask(row) {
  if (!row) return null;
  return { ...row };
}

export function createHandoffTask(input = {}) {
  const id = crypto.randomUUID();
  const now = nowIso();
  const status = VALID_STATUSES.includes(input.status) ? input.status : 'open';
  const priority = VALID_PRIORITIES.includes(input.priority) ? input.priority : 'normal';
  db().prepare(
    `INSERT INTO handoff_tasks
      (id, conversation_id, enquiry_id, lead_id, assigned_to, customer_name, business_name,
       reason, priority, status, due_date, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.conversation_id || null,
    input.enquiry_id || null,
    input.lead_id || null,
    String(input.assigned_to || '').trim(),
    String(input.customer_name || '').trim(),
    String(input.business_name || '').trim(),
    String(input.reason || '').trim(),
    priority,
    status,
    input.due_date || null,
    String(input.notes || '').trim(),
    now,
    now,
  );
  return readHandoffTask(id);
}

export function readHandoffTask(id) {
  return rowToTask(db().prepare('SELECT * FROM handoff_tasks WHERE id = ?').get(id));
}

export function listHandoffTasks(filters = {}) {
  const conditions = [];
  const params = [];
  if (filters.status) { conditions.push('status = ?'); params.push(filters.status); }
  if (filters.priority) { conditions.push('priority = ?'); params.push(filters.priority); }
  if (filters.assigned_to) { conditions.push('assigned_to = ?'); params.push(filters.assigned_to); }
  if (filters.conversation_id) { conditions.push('conversation_id = ?'); params.push(filters.conversation_id); }
  let sql = 'SELECT * FROM handoff_tasks';
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY created_at DESC';
  if (filters.limit) { sql += ' LIMIT ?'; params.push(Number(filters.limit)); }
  return db().prepare(sql).all(...params).map(rowToTask);
}

export function updateHandoffTask(id, patch = {}) {
  const existing = readHandoffTask(id);
  if (!existing) return null;
  const fields = [];
  const params = [];
  const set = (col, val) => { fields.push(`${col} = ?`); params.push(val); };
  if (patch.assigned_to !== undefined) set('assigned_to', String(patch.assigned_to || '').trim());
  if (patch.reason !== undefined) set('reason', String(patch.reason || '').trim());
  if (patch.priority !== undefined && VALID_PRIORITIES.includes(patch.priority)) set('priority', patch.priority);
  if (patch.status !== undefined && VALID_STATUSES.includes(patch.status)) set('status', patch.status);
  if (patch.due_date !== undefined) set('due_date', patch.due_date || null);
  if (patch.notes !== undefined) set('notes', String(patch.notes || '').trim());
  if (patch.customer_name !== undefined) set('customer_name', String(patch.customer_name || '').trim());
  if (patch.business_name !== undefined) set('business_name', String(patch.business_name || '').trim());
  if (!fields.length) return existing;
  set('updated_at', nowIso());
  params.push(id);
  db().prepare(`UPDATE handoff_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return readHandoffTask(id);
}

export function findOpenHandoffTask(conversationId) {
  if (!conversationId) return null;
  return rowToTask(db().prepare("SELECT * FROM handoff_tasks WHERE conversation_id = ? AND status IN ('open','in_progress') ORDER BY created_at DESC LIMIT 1").get(conversationId));
}

export default { createHandoffTask, readHandoffTask, listHandoffTasks, updateHandoffTask, findOpenHandoffTask };