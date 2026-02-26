const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");

const {
  getPerfil,
  cambiarPassword,
  cambiarCorreo
} = require("../controllers/usuarioController");

router.get("/perfil", authMiddleware, getPerfil);
router.put("/cambiar-password", authMiddleware, cambiarPassword);
router.put("/cambiar-correo", authMiddleware, cambiarCorreo);


module.exports = router;
