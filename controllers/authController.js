const db = require("../config/db");
const bcrypt = require("bcrypt");

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 3;

exports.login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "Datos incompletos" });
  }

  const u = String(username).trim().toLowerCase();

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
      SELECT 
        id_usuario,
        username,
        nombre,
        apellido,
        correo,
        rol,
        password_hash,
        must_change_password,
        must_set_email,
        failed_login_count,
        locked_until
      FROM usuario
      WHERE username = $1
        AND activo = true
      FOR UPDATE
      `,
      [u]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(401).json({ message: "Usuario no encontrado" });
    }

    const user = result.rows[0];

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        message: "Cuenta bloqueada por intentos fallidos. Intentá de nuevo en unos minutos.",
        locked_until: user.locked_until,
      });
    }

    let ok = false;

    if (user.password_hash && user.password_hash.startsWith("$2")) {
      const hash = user.password_hash.replace("$2y$", "$2b$");
      ok = await bcrypt.compare(password, hash);
    } else {
      ok = user.password_hash === password;
    }

    if (!ok) {
      const nextCount = (user.failed_login_count || 0) + 1;

      if (nextCount >= MAX_ATTEMPTS) {
        await client.query(
          `
          UPDATE usuario
          SET failed_login_count = 0,
              locked_until = now() + ($1 || ' minutes')::interval
          WHERE id_usuario = $2
          `,
          [LOCK_MINUTES, user.id_usuario]
        );

        await client.query("COMMIT");
        return res.status(403).json({
          message: `Demasiados intentos. Cuenta bloqueada por ${LOCK_MINUTES} minutos.`,
        });
      }

      await client.query(
        `
        UPDATE usuario
        SET failed_login_count = $1,
            locked_until = NULL
        WHERE id_usuario = $2
        `,
        [nextCount, user.id_usuario]
      );

      await client.query("COMMIT");
      return res.status(401).json({
        message: "Contraseña incorrecta",
        intentos_restantes: MAX_ATTEMPTS - nextCount,
      });
    }

    await client.query(
      `
      UPDATE usuario
      SET failed_login_count = 0,
          locked_until = NULL
      WHERE id_usuario = $1
      `,
      [user.id_usuario]
    );

    await client.query("COMMIT");

    return res.json({
      id_usuario: user.id_usuario,
      username: user.username,
      nombre: user.nombre,
      apellido: user.apellido,
      correo: user.correo,
      rol: user.rol,
      must_change_password: user.must_change_password,
      must_set_email: user.must_set_email,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error login:", error);
    return res.status(500).json({ message: "Error en el servidor" });
  } finally {
    client.release();
  }
};