const express = require("express");
const router = express.Router();
const { getMiHorario } = require("../controllers/alumnoController");

router.get("/mi-horario", getMiHorario);

module.exports = router;
