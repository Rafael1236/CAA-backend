const express = require("express");
const router = express.Router();

const { getSemanas } = require("../controllers/adminController");
const { publicarSemana } = require("../controllers/adminController");
const { asegurarSemanaFutura } = require("../controllers/adminController");
const { getAeronavesActivas } = require("../controllers/adminController");
const { getCalendario } = require("../controllers/adminController");
const { getBloquesHorario } = require("../controllers/adminController");
const { getBloquesBloqueados } = require("../controllers/adminController");
const adminController = require("../controllers/adminController");

router.get("/semanas", getSemanas);
router.post("/publicar-semana", publicarSemana);
router.post("/asegurar-semana-futura", asegurarSemanaFutura);
router.get("/aeronaves", getAeronavesActivas);
router.get("/calendario", getCalendario);
router.get("/bloques-horario", getBloquesHorario);
router.put("/guardar-cambios", adminController.guardarCambios);
router.get("/bloques-bloqueados", getBloquesBloqueados);



module.exports = router;