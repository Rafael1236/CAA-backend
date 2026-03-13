const express = require("express");
const router = express.Router();
const outboxController = require("../controllers/outboxController");

router.get("/pendientes", outboxController.getPendientes);
router.patch("/:id/procesado", outboxController.marcarProcesado);
router.patch("/:id/error", outboxController.marcarError);

module.exports = router;