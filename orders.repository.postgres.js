import { pool } from "./db.js";

export async function createOrder({
  order_id,
  status,
  customer,
  financials,
  line_items,
  polymorphic_metadata,
  event,
}) {
  await pool.query(
    `INSERT INTO orders
      (order_id, "timestamp", status, customer, financials, line_items, polymorphic_metadata, event_timeline)
     VALUES ($1, now(), $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb)`,
    [
      order_id,
      status,
      customer ? JSON.stringify(customer) : null,
      financials ? JSON.stringify(financials) : null,
      line_items ? JSON.stringify(line_items) : null,
      polymorphic_metadata ? JSON.stringify(polymorphic_metadata) : null,
      JSON.stringify([event]),
    ]
  );
}

export async function getOrder(orderId) {
  const { rows } = await pool.query(
    `SELECT order_id, status FROM orders WHERE order_id = $1`,
    [orderId]
  );
  return rows[0] ?? null;
}

export async function addLineItems(orderId, lineItems, event) {
  const { rows } = await pool.query(
    `UPDATE orders
     SET line_items = COALESCE(line_items, '[]'::jsonb) || $2::jsonb,
         event_timeline = event_timeline || $3::jsonb
     WHERE order_id = $1
     RETURNING order_id, line_items, event_timeline`,
    [orderId, JSON.stringify(lineItems), JSON.stringify([event])]
  );
  return rows[0] ?? null;
}

export async function transitionStatus(orderId, expectedStatus, newStatus, event) {
  const { rows } = await pool.query(
    `UPDATE orders
     SET status = $2, event_timeline = event_timeline || $3::jsonb
     WHERE order_id = $1 AND status = $4
     RETURNING order_id, status, event_timeline`,
    [orderId, newStatus, JSON.stringify([event]), expectedStatus]
  );
  return rows[0] ?? null;
}

export const ordersRepositoryPostgres = {
  createOrder,
  getOrder,
  addLineItems,
  transitionStatus,
};
