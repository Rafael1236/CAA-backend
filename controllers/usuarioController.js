const db = require("../config/db");
const bcrypt = require("bcrypt");


exports.getPerfil = async (req, res) => {
  const user = req.user;

  const result = await db.query(`
    SELECT
      id_usuario,
      nombre,
      apellido,
      correo,
      rol,
      must_change_password
    FROM usuario
    WHERE id_usuario = $1
  `, [user.id_usuario]);

  res.json(result.rows[0]);
};

exports.cambiarPassword = async (req, res) => {
  const { nuevaPassword } = req.body;
  const user = req.user;

  const regex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
  if (!regex.test(nuevaPassword)) {
    return res.status(400).json({
      message: "Mínimo 8 caracteres, una mayúscula y un número"
    });
  }

  const hash = await bcrypt.hash(nuevaPassword, 10);

  await db.query(`
    UPDATE usuario
    SET password_hash = $1,
        must_change_password = false
    WHERE id_usuario = $2
  `, [hash, user.id_usuario]);

  res.json({ message: "Contraseña actualizada" });
};

exports.cambiarCorreo = async (req, res) => {
  const { nuevoCorreo } = req.body;
  const user = req.user;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(nuevoCorreo)) {
    return res.status(400).json({ message: "Correo inválido" });
  }

  try {
    await db.query(
      `
      UPDATE usuario
      SET correo = $1
      WHERE id_usuario = $2
      `,
      [nuevoCorreo.toLowerCase(), user.id_usuario]
    );

    res.json({ message: "Correo actualizado" });
  } catch (e) {
    if (e.code === "23505") {
      return res.status(400).json({ message: "Ese correo ya está en uso" });
    }
    console.error(e);
    res.status(500).json({ message: "Error actualizando correo" });
  }
};