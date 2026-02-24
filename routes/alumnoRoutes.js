const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

const { getMiHorario } = require("../controllers/alumnoController");
const { getMiLicencia } = require("../controllers/alumnoController");
const { cancelarVuelo } = require("../controllers/alumnoController");
const { getBloquesBloqueados } = require("../controllers/alumnoController");

router.get("/mi-horario",authMiddleware, getMiHorario);
router.get("/licencia",authMiddleware, getMiLicencia);
router.get("/bloques-bloqueados",authMiddleware, getBloquesBloqueados);
router.patch("/vuelos/:id_vuelo/cancelar", authMiddleware, cancelarVuelo);

module.exports = router;
