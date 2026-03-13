const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const webhookController = require("../controllers/webhookController");

const router = express.Router();

router.get("/eventos-disponibles", authMiddleware, webhookController.getEventosDisponibles);
router.get("/", authMiddleware, webhookController.getWebhooks);
router.get("/:id", authMiddleware, webhookController.getWebhookById);
router.post("/", authMiddleware, webhookController.createWebhook);
router.put("/:id", authMiddleware, webhookController.updateWebhook);
router.put("/:id/eventos", authMiddleware, webhookController.updateWebhookEventos);
router.post("/:id/test", authMiddleware, webhookController.testWebhook);

module.exports = router;