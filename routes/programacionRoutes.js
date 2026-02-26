const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

const { getCalendario } = require("../controllers/programacionController");
const { getAeronavesActivas } = require("../controllers/programacionController");
const { enRevision } = require("../controllers/programacionController");
const { guardarCambios } = require("../controllers/programacionController");
const { getBloquesBloqueados } = require("../controllers/programacionController");
const { cancelarVuelo } = require("../controllers/programacionController");


router.get("/calendario",authMiddleware, getCalendario);
router.get("/aeronaves",authMiddleware, getAeronavesActivas);
router.get("/bloques-bloqueados",authMiddleware, getBloquesBloqueados);
router.post("/solicitudes/:id_solicitud/en-revision", authMiddleware,enRevision);
router.post("/guardar-cambios", authMiddleware,guardarCambios);
router.patch("/vuelos/:id_vuelo/cancelar", authMiddleware,cancelarVuelo);

module.exports = router;