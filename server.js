import express from "express";
import { ordersRepositoryPostgres as ordersRepository } from "./orders.repository.postgres.js";
import {
  createOrderHandler,
  addItemsHandler,
  makePaymentHandler,
  paymentWebhookHandler,
  startDeliveryHandler,
  completeOrderHandler,
} from "./orders.service.js";

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
