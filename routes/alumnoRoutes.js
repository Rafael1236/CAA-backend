const express = require("express");
const router = express.Router();
const { getMiHorario } = require("../controllers/alumnoController");
const { getMiLicencia } = require("../controllers/alumnoController");

router.get("/mi-horario", getMiHorario);
router.get("/licencia", getMiLicencia);

module.exports = router;
