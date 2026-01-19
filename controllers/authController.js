const db = require("../config/db");

exports.login = async (req, res) => {
  const { correo, password } = req.body;

  if (!correo || !password) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  try {
    const result = await db.query(
      `
      SELECT u.id_usuario, u.nombre, r.nombre AS rol, u.password_hash
      FROM usuario u
      JOIN rol r ON r.id_rol = u.id_rol
      WHERE u.correo = $1 AND u.activo = true
      `,
      [correo]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Usuario no encontrado" });
    }

    const user = result.rows[0];

    // ⚠️ Solo para MVP (sin bcrypt)
    if (user.password_hash !== password) {
      return res.status(401).json({ message: "Contraseña incorrecta" });
    }

    res.json({
      id_usuario: user.id_usuario,
      nombre: user.nombre,
      rol: user.rol,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
};
