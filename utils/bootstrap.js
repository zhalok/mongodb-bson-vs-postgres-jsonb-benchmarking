import express from "express";
import {
  createOrderHandler,
  addItemsHandler,
  makePaymentHandler,
  paymentWebhookHandler,
  startDeliveryHandler,
  completeOrderHandler,
} from "../services/orders.service.js";
import { ordersRepositoryMongodb } from "../repositories/orders.repository.mongodb.js";
import { ordersRepositoryPostgres } from "../repositories/orders.repository.postgres.js";

export function createApp(ordersRepository) {
  const app = express();
  app.use(express.json());

  app.post("/orders", (req, res) => createOrderHandler(req, res, ordersRepository));
  app.post("/orders/:orderId/add-items", (req, res) => addItemsHandler(req, res, ordersRepository));
  app.post("/orders/:orderId/make-payment", (req, res) =>
    makePaymentHandler(req, res, ordersRepository)
  );
  app.post("/orders/:orderId/payment-webhook", (req, res) =>
    paymentWebhookHandler(req, res, ordersRepository)
  );
  app.post("/orders/:orderId/start-delivery", (req, res) =>
    startDeliveryHandler(req, res, ordersRepository)
  );
  app.post("/orders/:orderId/complete-order", (req, res) =>
    completeOrderHandler(req, res, ordersRepository)
  );

  return app;
}

export function createMongoApp() {
  return createApp(ordersRepositoryMongodb);
}

export function createPostgresApp() {
  return createApp(ordersRepositoryPostgres);
}
