const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const router = express.Router();

const { getSemanas } = require("../controllers/adminController");
const { publicarSemana } = require("../controllers/adminController");
const { asegurarSemanaFutura } = require("../controllers/adminController");
const { getAeronavesActivas } = require("../controllers/adminController");
const { getCalendario } = require("../controllers/adminController");
const { getBloquesHorario } = require("../controllers/adminController");
const { getBloquesBloqueados } = require("../controllers/adminController");
const { cancelarVueloAdmin } = require("../controllers/adminController");
const adminController = require("../controllers/adminController");

router.get("/semanas",authMiddleware, getSemanas);
router.post("/publicar-semana",authMiddleware, publicarSemana);
router.post("/asegurar-semana-futura",authMiddleware, asegurarSemanaFutura);
router.get("/aeronaves",authMiddleware, getAeronavesActivas);
router.get("/calendario",authMiddleware, getCalendario);
router.get("/bloques-horario",authMiddleware, getBloquesHorario);
router.put("/guardar-cambios",authMiddleware, adminController.guardarCambios);
router.get("/bloques-bloqueados", authMiddleware,getBloquesBloqueados);
router.patch("/admin/vuelos/:id_vuelo/cancelar",authMiddleware, cancelarVueloAdmin);



module.exports = router;