const db = require("../config/db");

function requireAlumno(req, res) {
  const raw = req.headers["x-user"];
  if (!raw) return res.status(401).json({ message: "No autenticado" });

  let user;
  try { user = JSON.parse(raw); } catch { 
    return res.status(400).json({ message: "Header x-user inválido" });
  }

  if (user.rol !== "ALUMNO") {
    res.status(403).json({ message: "No autorizado" });
    return null;
  }
  return user;
}

exports.getMiHorario = async (req, res) => {
  try {
    const userHeader = req.headers["x-user"];
    if (!userHeader) {
      return res.status(401).json({ message: "Usuario no autenticado" });
    }

    const user = JSON.parse(userHeader);
    const { week = "current" } = req.query;

    const alumnoRes = await db.query(
      "SELECT id_alumno FROM alumno WHERE id_usuario = $1",
      [user.id_usuario]
    );

    if (alumnoRes.rows.length === 0) {
      return res.status(404).json({ message: "Alumno no encontrado" });
    }

    const idAlumno = alumnoRes.rows[0].id_alumno;

    const semanaQuery =
      week === "next"
        ? `
          SELECT id_semana
          FROM semana_vuelo
          WHERE fecha_inicio > CURRENT_DATE
          ORDER BY fecha_inicio
          LIMIT 1
        `
        : `
          SELECT id_semana
          FROM semana_vuelo
          WHERE CURRENT_DATE BETWEEN fecha_inicio AND fecha_fin
            AND publicada = true
          ORDER BY fecha_inicio DESC
          LIMIT 1

        `;

    const semanaRes = await db.query(semanaQuery);

    if (semanaRes.rows.length === 0) {
      return res.json([]);
    }

    const idSemana = semanaRes.rows[0].id_semana;

    const result = await db.query(
      `
      SELECT
        v.id_vuelo,
        v.id_bloque,
        v.dia_semana,
        b.hora_inicio,
        b.hora_fin,
        ae.codigo AS aeronave_codigo,
        v.estado
      FROM vuelo v
      JOIN bloque_horario b ON b.id_bloque = v.id_bloque
      JOIN aeronave ae ON ae.id_aeronave = v.id_aeronave
      WHERE v.id_alumno = $1
        AND v.id_semana = $2
      ORDER BY b.hora_inicio, v.dia_semana
      `,
      [idAlumno, idSemana]
    );


    res.json(result.rows);
  } catch (error) {
    console.error("Error obtener horario alumno:", error);
    res.status(500).json({ message: "Error al obtener horario" });
  }
};

exports.getMiLicencia = async (req, res) => {
  try {
    const userHeader = req.headers["x-user"];
    if (!userHeader) { 
      return res.status(401).json({ message: "Usuario no autenticado" });
    }

    const user = JSON.parse(userHeader);

    const result = await db.query(
      `
      SELECT
        l.id_licencia,
        l.nombre,
        l.nivel,
        l.prioridad
      FROM alumno a
      JOIN licencia l ON l.id_licencia = a.id_licencia
      WHERE a.id_usuario = $1
      `,
      [user.id_usuario]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Licencia no encontrada" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error obtener licencia:", error);
    res.status(500).json({ message: "Error al obtener licencia" });
  }
};

exports.cancelarVuelo = async (req, res) => {
  const client = await db.connect();

  try {
    const user = requireAlumno(req, res);
    if (!user) return;

    const { id_vuelo } = req.params;

    const alumnoRes = await client.query(
      `SELECT id_alumno FROM alumno WHERE id_usuario = $1 AND activo = true`,
      [user.id_usuario]
    );

    if (alumnoRes.rows.length === 0) {
      client.release();
      return res.status(404).json({ message: "Alumno no encontrado" });
    }

    const idAlumno = alumnoRes.rows[0].id_alumno;

    await client.query("BEGIN");

    const q = await client.query(
      `
      SELECT 
        v.id_vuelo,
        v.estado,
        v.id_alumno,
        v.id_semana,
        sv.fecha_inicio,
        v.dia_semana,
        bh.hora_inicio,
        (
          (sv.fecha_inicio::timestamp)
          + make_interval(days => (v.dia_semana - 1))
          + (bh.hora_inicio::time)
        ) AS fecha_hora_vuelo
      FROM vuelo v
      JOIN semana_vuelo sv ON sv.id_semana = v.id_semana
      JOIN bloque_horario bh ON bh.id_bloque = v.id_bloque
      WHERE v.id_vuelo = $1
      FOR UPDATE
      `,
      [id_vuelo]
    );

    if (q.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Vuelo no encontrado" });
    }

    const vuelo = q.rows[0];

    if (vuelo.id_alumno !== idAlumno) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "No podés cancelar este vuelo" });
    }

    if (vuelo.estado === "CANCELADO") {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "El vuelo ya está cancelado" });
    }

    const timeCheck = await client.query(
      `SELECT (now() <= ($1::timestamp - interval '24 hour')) AS permitido`,
      [vuelo.fecha_hora_vuelo]
    );

    if (!timeCheck.rows[0].permitido) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        message: "Solo podés cancelar con más de 24 horas de anticipación",
        fecha_hora_vuelo: vuelo.fecha_hora_vuelo,
      });
    }

    await client.query(
      `UPDATE vuelo SET estado = 'CANCELADO' WHERE id_vuelo = $1`,
      [id_vuelo]
    );

    await client.query("COMMIT");
    return res.json({ message: "Vuelo cancelado" });

  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Error cancelarVuelo:", e);
    return res.status(500).json({ message: "Error cancelando vuelo" });
  } finally {
    client.release();
  }
};

exports.getBloquesBloqueados = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id_bloque, dia_semana, motivo
      FROM bloque_bloqueado_dia
      ORDER BY dia_semana, id_bloque
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Error bloques bloqueados:", error);
    res.status(500).json({ message: "Error obtener bloqueos" });
  }
};