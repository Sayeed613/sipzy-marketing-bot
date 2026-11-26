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
    { id: '000001', product_type: 'Cold', cup_size: '250ml', description: 'Foldable cold cup with straw intake, 250ml' },
    { id: '000002', product_type: 'Cold', cup_size: '350ml', description: 'Foldable cold cup with straw intake, 350ml' },
    { id: '000003', product_type: 'Cold', cup_size: '450ml', description: 'Foldable cold cup with straw intake, 450ml' },
    { id: '000004', product_type: 'Hot',  cup_size: '250ml', description: 'Foldable hot cup with 3-fold closure, 250ml' },
    { id: '000005', product_type: 'Hot',  cup_size: '350ml', description: 'Foldable hot cup with 3-fold closure, 350ml' },
    { id: '000006', product_type: 'Hot',  cup_size: '450ml', description: 'Foldable hot cup with 3-fold closure, 450ml' },
  ];
  const insert = dbInstance.prepare(
    `INSERT OR IGNORE INTO products (id, product_type, cup_size, description, active)
     VALUES (@id, @product_type, @cup_size, @description, 1)`
  );
  const update = dbInstance.prepare(
    `UPDATE products SET description = @description, product_type = @product_type, cup_size = @cup_size, active = 1 WHERE id = @id`
  );
  for (const p of products) {
    insert.run(p);
    update.run(p);
  }
}

export { listProducts, getProduct, seedProducts };
