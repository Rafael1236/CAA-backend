const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

const { getAeronavesPermitidas } = require("../controllers/agendarController");
const { getMisSolicitudes } = require("../controllers/agendarController");
const { guardarSolicitud } = require("../controllers/agendarController");
const { getBloquesHorario } = require("../controllers/agendarController");
const { getBloquesOcupados } = require("../controllers/agendarController");
const { getBloquesBloqueados } = require("../controllers/agendarController");


router.get("/bloques-ocupados",authMiddleware, getBloquesOcupados);
router.get("/aeronaves-permitidas",authMiddleware, getAeronavesPermitidas);
router.post("/solicitar-vuelos",authMiddleware, guardarSolicitud);
router.get("/bloques-bloqueados",authMiddleware, getBloquesBloqueados);
router.get("/mis-solicitudes",authMiddleware, getMisSolicitudes);
router.get("/bloques-horario",authMiddleware, getBloquesHorario);

module.exports = router;
