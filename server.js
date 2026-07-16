import express from "express";
import { pool } from "./db.js";

const app = express();
app.use(express.json());

const EVENT_GAP_MS = 5000;

const SCHEDULED_EVENTS = [
  { event: "item_added", payload: { product_id: "prod_4412" } },
  { event: "checkout_started", payload: { step: 1, abandoned_previous: false } },
  { event: "payment_submitted", payload: { gateway: "Stripe", method: "ApplePay" } },
];

async function appendEvent(orderId, event) {
  await pool.query(
    `UPDATE orders
     SET event_timeline = event_timeline || $2::jsonb
     WHERE order_id = $1`,
    [orderId, JSON.stringify([event])]
  );
}

async function getOrder(orderId) {
  const { rows } = await pool.query(
    `SELECT order_id, status FROM orders WHERE order_id = $1`,
    [orderId]
  );
  return rows[0] ?? null;
}

async function transitionStatus(orderId, expectedStatus, newStatus, event) {
  const { rows } = await pool.query(
    `UPDATE orders
     SET status = $2, event_timeline = event_timeline || $3::jsonb
     WHERE order_id = $1 AND status = $4
     RETURNING order_id, status, event_timeline`,
    [orderId, newStatus, JSON.stringify([event]), expectedStatus]
  );
  return rows[0] ?? null;
}

function scheduleEvents(orderId) {
  SCHEDULED_EVENTS.forEach((template, index) => {
    setTimeout(async () => {
      const event = { ...template, timestamp: new Date().toISOString() };
      try {
        await appendEvent(orderId, event);
      } catch (err) {
        console.error(`Failed to append event "${event.event}" for order ${orderId}`, err);
      }
    }, EVENT_GAP_MS * (index + 1));
  });
}

app.post("/orders", async (req, res) => {
  const { order_id, status, customer, financials, line_items, polymorphic_metadata } = req.body;

  if (!order_id || !status) {
    return res.status(400).json({ error: "order_id and status are required" });
  }

  const cartCreatedEvent = {
    event: "cart_created",
    timestamp: new Date().toISOString(),
    payload: {},
  };

  try {
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
        JSON.stringify([cartCreatedEvent]),
      ]
    );

    scheduleEvents(order_id);

    res.status(201).json({ order_id, event_timeline: [cartCreatedEvent] });
  } catch (err) {
    console.error("Failed to create order", err);
    res.status(500).json({ error: "Failed to create order" });
  }
});

app.post("/orders/:orderId/add-items", async (req, res) => {
  const { orderId } = req.params;
  const { line_items } = req.body;

  if (!Array.isArray(line_items) || line_items.length === 0) {
    return res.status(400).json({ error: "line_items must be a non-empty array" });
  }

  const order = await getOrder(orderId);
  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }

  const event = {
    event: "items_added",
    timestamp: new Date().toISOString(),
    payload: { items: line_items.map((item) => item.sku ?? item.item_id) },
  };

  try {
    const { rows } = await pool.query(
      `UPDATE orders
       SET line_items = COALESCE(line_items, '[]'::jsonb) || $2::jsonb,
           event_timeline = event_timeline || $3::jsonb
       WHERE order_id = $1
       RETURNING order_id, line_items, event_timeline`,
      [orderId, JSON.stringify(line_items), JSON.stringify([event])]
    );
    res.status(200).json(rows[0]);
  } catch (err) {
    console.error("Failed to add items", err);
    res.status(500).json({ error: "Failed to add items" });
  }
});

app.post("/orders/:orderId/make-payment", async (req, res) => {
  const { orderId } = req.params;

  const event = {
    event: "payment_initiated",
    timestamp: new Date().toISOString(),
    payload: { method: req.body?.method ?? "unknown" },
  };

  try {
    const updated = await transitionStatus(orderId, "PLACED", "PAYMENT_PROCESSING", event);
    if (!updated) {
      const order = await getOrder(orderId);
      if (!order) return res.status(404).json({ error: "Order not found" });
      return res.status(409).json({
        error: `Cannot start payment from status "${order.status}"`,
      });
    }
    res.status(200).json(updated);
  } catch (err) {
    console.error("Failed to start payment", err);
    res.status(500).json({ error: "Failed to start payment" });
  }
});

app.post("/orders/:orderId/payment-webhook", async (req, res) => {
  const { orderId } = req.params;

  const event = {
    event: "payment_successful",
    timestamp: new Date().toISOString(),
    payload: { transaction_id: req.body?.transaction_id ?? null },
  };

  try {
    const updated = await transitionStatus(
      orderId,
      "PAYMENT_PROCESSING",
      "PAYMENT_SUCCESSFUL",
      event
    );
    if (!updated) {
      const order = await getOrder(orderId);
      if (!order) return res.status(404).json({ error: "Order not found" });
      return res.status(409).json({
        error: `Cannot confirm payment from status "${order.status}"`,
      });
    }
    res.status(200).json(updated);
  } catch (err) {
    console.error("Failed to confirm payment", err);
    res.status(500).json({ error: "Failed to confirm payment" });
  }
});

app.post("/orders/:orderId/start-delivery", async (req, res) => {
  const { orderId } = req.params;

  const event = {
    event: "delivery_started",
    timestamp: new Date().toISOString(),
    payload: {
      carrier: req.body?.carrier ?? "unknown",
      tracking_number: req.body?.tracking_number ?? null,
    },
  };

  try {
    const updated = await transitionStatus(
      orderId,
      "PAYMENT_SUCCESSFUL",
      "DELIVERING",
      event
    );
    if (!updated) {
      const order = await getOrder(orderId);
      if (!order) return res.status(404).json({ error: "Order not found" });
      return res.status(409).json({
        error: `Cannot start delivery from status "${order.status}"`,
      });
    }
    res.status(200).json(updated);
  } catch (err) {
    console.error("Failed to start delivery", err);
    res.status(500).json({ error: "Failed to start delivery" });
  }
});

app.post("/orders/:orderId/complete-order", async (req, res) => {
  const { orderId } = req.params;

  const event = {
    event: "order_completed",
    timestamp: new Date().toISOString(),
    payload: {},
  };

  try {
    const updated = await transitionStatus(orderId, "DELIVERING", "COMPLETED", event);
    if (!updated) {
      const order = await getOrder(orderId);
      if (!order) return res.status(404).json({ error: "Order not found" });
      return res.status(409).json({
        error: `Cannot complete order from status "${order.status}"`,
      });
    }
    res.status(200).json(updated);
  } catch (err) {
    console.error("Failed to complete order", err);
    res.status(500).json({ error: "Failed to complete order" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
