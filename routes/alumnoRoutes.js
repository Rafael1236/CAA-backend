const express = require("express");
const router = express.Router();
const { getMiHorario } = require("../controllers/alumnoController");
const { getMiLicencia } = require("../controllers/alumnoController");
const { cancelarVuelo } = require("../controllers/alumnoController");

router.get("/mi-horario", getMiHorario);
router.get("/licencia", getMiLicencia);
router.patch("/vuelos/:id_vuelo/cancelar", cancelarVuelo);

module.exports = router;
