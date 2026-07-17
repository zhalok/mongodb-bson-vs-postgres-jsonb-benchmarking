import { db } from "../db-clients/mongo.js";

const orders = db.collection("orders");
await orders.createIndex({ timestamp: -1 });

export async function createOrder({
  order_id,
  status,
  customer,
  financials,
  line_items,
  polymorphic_metadata,
  event,
}) {
  await orders.insertOne({
    order_id,
    timestamp: new Date(),
    status,
    customer: customer ?? null,
    financials: financials ?? null,
    line_items: line_items ?? [],
    polymorphic_metadata: polymorphic_metadata ?? null,
    event_timeline: [event],
  });
}

export async function getOrder(orderId) {
  return orders.findOne(
    { order_id: orderId },
    { projection: { _id: 0, order_id: 1, status: 1 } }
  );
}

export async function addLineItems(orderId, lineItems, event) {
  const result = await orders.findOneAndUpdate(
    { order_id: orderId },
    {
      $push: {
        line_items: { $each: lineItems },
        event_timeline: { $each: [event] },
      },
    },
    {
      returnDocument: "after",
      projection: { _id: 0, order_id: 1, line_items: 1, event_timeline: 1 },
    }
  );
  return result ?? null;
}

export async function transitionStatus(orderId, expectedStatus, newStatus, event) {
  const result = await orders.findOneAndUpdate(
    { order_id: orderId, status: expectedStatus },
    {
      $set: { status: newStatus },
      $push: { event_timeline: event },
    },
    {
      returnDocument: "after",
      projection: { _id: 0, order_id: 1, status: 1, event_timeline: 1 },
    }
  );
  return result ?? null;
}

export async function getOrders() {
  return orders
    .aggregate([
      { $sort: { timestamp: -1 } },
      { $limit: 100 },
      {
        $project: {
          _id: 0,
          order_id: 1,
          timestamp: 1,
          customer: {
            id: "$customer.id",
            tier: "$customer.tier",
            geo_location: { country: "$customer.session_context.geo_location.country" },
          },
          financials: { amount: { final_total: "$financials.amounts.final_total" } },
        },
      },
    ])
    .toArray();
}

export const ordersRepositoryMongodb = {
  createOrder,
  getOrder,
  getOrders,
  addLineItems,
  transitionStatus,
};
