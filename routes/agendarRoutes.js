const express = require("express");
const router = express.Router();
const { getAeronavesPermitidas } = require("../controllers/agendarController");
const { getMisSolicitudes } = require("../controllers/agendarController");
const { guardarSolicitud } = require("../controllers/agendarController");
const { getBloquesHorario } = require("../controllers/agendarController");
const { getBloquesOcupados } = require("../controllers/agendarController");


router.get("/bloques-ocupados", getBloquesOcupados);
router.get("/aeronaves-permitidas", getAeronavesPermitidas);
router.post("/solicitar-vuelos", guardarSolicitud);
router.get("/mis-solicitudes", getMisSolicitudes);
router.get("/bloques-horario", getBloquesHorario);

module.exports = router;
