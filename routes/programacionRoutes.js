const express = require("express");
const router = express.Router();
const { getCalendario } = require("../controllers/programacionController");
const { getAeronavesActivas } = require("../controllers/programacionController");
const { enRevision } = require("../controllers/programacionController");
const { guardarCambios } = require("../controllers/programacionController");
const { getBloquesBloqueados } = require("../controllers/programacionController");


router.get("/calendario", getCalendario);
router.get("/aeronaves", getAeronavesActivas);
router.get("/bloques-bloqueados", getBloquesBloqueados);
router.post("/solicitudes/:id_solicitud/en-revision", enRevision);
router.post("/guardar-cambios", guardarCambios);



module.exports = router;


