const db = require("../config/db");
const bcrypt = require("bcrypt");


exports.login = async (req, res) => {
  const { correo, password } = req.body;

  if (!correo || !password) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  try {
    const result = await db.query(
      `
      SELECT 
        id_usuario,
        nombre,
        apellido,
        correo,
        rol,
        password_hash,
        must_change_password
      FROM usuario
      WHERE correo = $1
        AND activo = true
      `,
      [correo]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Usuario no encontrado" });
    }

    const user = result.rows[0];

    // ✅ Soporta passwords hasheadas (bcrypt) y también texto plano (temporal)
    let ok = false;

    if (user.password_hash && user.password_hash.startsWith("$2")) {
      // bcrypt hash
      ok = await bcrypt.compare(password, user.password_hash);
    } else {
      // texto plano (temporal mientras migras)
      ok = user.password_hash === password;
    }

    if (!ok) {
      return res.status(401).json({ message: "Contraseña incorrecta" });
    }

    res.json({
      id_usuario: user.id_usuario,
      nombre: user.nombre,
      apellido: user.apellido,
      correo: user.correo,
      rol: user.rol,
      must_change_password: user.must_change_password,
    });
  } catch (error) {
    console.error("Error login:", error);
    res.status(500).json({ message: "Error en el servidor" });
  }
};
