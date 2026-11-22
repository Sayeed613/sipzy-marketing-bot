import { getDb } from '../db/index.js';

const db = getDb();

/**
 * List all products, optionally filtered by type and active flag.
 */
function listProducts(filters = {}) {
  const { productType, active } = filters;
  let sql = 'SELECT * FROM products';
  const params = [];
  const conditions = [];
  if (productType) {
    conditions.push('product_type = ?');
    params.push(productType);
  }
  if (active !== undefined) {
    conditions.push('active = ?');
    params.push(active ? 1 : 0);
  }
  if (conditions.length) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY product_type, cup_size';
  return db.prepare(sql).all(...params);
}

/**
 * Get a single product by id.
 */
function getProduct(id) {
  return db.prepare('SELECT * FROM products WHERE id = ?').get(id) || null;
}

/**
 * Seed the six SIPZY variants. Safe to call on every init:
 * INSERT OR IGNORE keeps the unique (product_type, cup_size) pairs once.
 */
function seedProducts(dbInstance) {
  const products = [
    { id: '000001', product_type: 'Cold', cup_size: '250ml', description: '250ml cold-foam paper cup' },
    { id: '000002', product_type: 'Cold', cup_size: '350ml', description: '350ml cold-foam paper cup' },
    { id: '000003', product_type: 'Cold', cup_size: '500ml', description: '500ml cold-foam paper cup' },
    { id: '000004', product_type: 'Hot',  cup_size: '250ml', description: '250ml hot-drink paper cup' },
    { id: '000005', product_type: 'Hot',  cup_size: '350ml', description: '350ml hot-drink paper cup' },
    { id: '000006', product_type: 'Hot',  cup_size: '500ml', description: '500ml hot-drink paper cup' },
  ];
  const insert = dbInstance.prepare(
    `INSERT OR IGNORE INTO products (id, product_type, cup_size, description, active)
     VALUES (@id, @product_type, @cup_size, @description, 1)`
  );
  for (const p of products) {
    insert.run(p);
  }
}

export { listProducts, getProduct, seedProducts };
