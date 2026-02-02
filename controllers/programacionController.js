const db = require("../config/db");

async function getNextSemanaId(client) {
  const semanaRes = await client.query(`
    SELECT id_semana
    FROM semana_vuelo
    WHERE fecha_inicio > CURRENT_DATE
    ORDER BY fecha_inicio
    LIMIT 1
  `);
  if (semanaRes.rows.length === 0) return null;
  return semanaRes.rows[0].id_semana;
}

function requireProgramacion(req, res) {
  const userHeader = req.headers["x-user"];
  if (!userHeader) {
    res.status(401).json({ message: "No autenticado" });
    return null;
  }
  const user = JSON.parse(userHeader);
  if (user.rol !== "PROGRAMACION") {
    res.status(403).json({ message: "Acceso denegado" });
    return null;
  }
  return user;
}

exports.getCalendario = async (req, res) => {
  try {
    const user = requireProgramacion(req, res);
    if (!user) return;

    const { week } = req.query;
    if (week && week !== "next") {
      return res.status(400).json({ message: "Solo se permite week=next" });
    }

    const idSemana = await getNextSemanaId(db);
    if (!idSemana) return res.json([]);

    const result = await db.query(
      `
      SELECT
        sv.id_detalle,
        sv.id_solicitud,
        ss.estado AS estado_solicitud,

        sv.id_semana,
        sv.dia_semana,
        sv.id_bloque,
        b.hora_inicio,
        b.hora_fin,

        sv.id_aeronave,
        ae.modelo AS aeronave_modelo,

        ss.id_alumno,
        u_al.nombre || ' ' || u_al.apellido AS alumno_nombre,

        i.id_instructor,
        u_ins.nombre || ' ' || u_ins.apellido AS instructor_nombre

      FROM solicitud_vuelo sv
      JOIN solicitud_semana ss ON ss.id_solicitud = sv.id_solicitud
      JOIN bloque_horario b ON b.id_bloque = sv.id_bloque
      JOIN aeronave ae ON ae.id_aeronave = sv.id_aeronave

      JOIN alumno al ON al.id_alumno = ss.id_alumno
      JOIN usuario u_al ON u_al.id_usuario = al.id_usuario

      JOIN instructor i ON i.id_instructor = al.id_instructor
      JOIN usuario u_ins ON u_ins.id_usuario = i.id_usuario

      WHERE sv.id_semana = $1
      ORDER BY b.hora_inicio, sv.dia_semana, ae.modelo
      `,
      [idSemana]
    );

    res.json(result.rows);
  } catch (e) {
    console.error("Error getCalendario:", e);
    res.status(500).json({ message: "Error obtener calendario" });
  }
};

exports.getAeronavesActivas = async (req, res) => {
  try {
    const user = requireProgramacion(req, res);
    if (!user) return;

    const result = await db.query(`
      SELECT id_aeronave, codigo, modelo, tipo
      FROM aeronave
      WHERE activa = true
      ORDER BY codigo
    `);

    res.json(result.rows);
  } catch (e) {
    console.error("Error getAeronavesActivas:", e);
    res.status(500).json({ message: "Error obtener aeronaves" });
  }
};

exports.enRevision = async (req, res) => {
  try {
    const user = requireProgramacion(req, res);
    if (!user) return;

    const { id_solicitud } = req.params;

    const r = await db.query(
      `
      UPDATE solicitud_semana
      SET estado='EN_REVISION',
          fecha_actualizacion=now()
      WHERE id_solicitud=$1
        AND estado='BORRADOR'
      RETURNING id_solicitud
      `,
      [id_solicitud]
    );

    if (r.rows.length === 0) {
      return res.status(400).json({ message: "No se pudo pasar a revisión (ya está en revisión o publicada)" });
    }

    res.json({ message: "Solicitud en revisión" });
  } catch (e) {
    console.error("Error enRevision:", e);
    res.status(500).json({ message: "Error" });
  }
};

exports.guardarCambios = async (req, res) => {
  const client = await db.connect();

  try {
    const user = requireProgramacion(req, res);
    if (!user) return;

    const { movimientos } = req.body;

    if (!Array.isArray(movimientos) || movimientos.length === 0) {
      return res.status(400).json({ message: "No hay cambios para guardar" });
    }

    const semanaRes = await client.query(
      `
      SELECT w.publicada
      FROM solicitud_vuelo sv
      JOIN semana_vuelo w ON w.id_semana = sv.id_semana
      WHERE sv.id_detalle = $1
      `,
      [movimientos[0].id_detalle]
    );

    if (semanaRes.rows.length === 0) {
      return res.status(404).json({ message: "Semana no encontrada" });
    }

    if (semanaRes.rows[0].publicada) {
      return res.status(403).json({
        message: "La semana ya fue publicada. Programación no puede modificar."
      });
    }

    await client.query("BEGIN");

    for (const m of movimientos) {
      const ocupado = await client.query(`
        SELECT 1
        FROM solicitud_vuelo
        WHERE id_semana = (
          SELECT id_semana FROM solicitud_vuelo WHERE id_detalle = $1
        )
          AND dia_semana = $2
          AND id_bloque = $3
          AND id_aeronave = $4
          AND id_detalle <> $1
      `, [m.id_detalle, m.dia_semana, m.id_bloque, m.id_aeronave]);

      if (ocupado.rows.length > 0) {
        throw Object.assign(
          new Error("Conflicto de bloque"),
          { code: "23505" }
        );
      }

      await client.query(
        `
        UPDATE solicitud_vuelo
        SET dia_semana = 0,
            id_bloque = NULL
        WHERE id_detalle = $1
        `,
        [m.id_detalle]
      );
    }

    for (const m of movimientos) {
      await client.query(
        `
        UPDATE solicitud_vuelo
        SET dia_semana = $1,
            id_bloque = $2,
            id_aeronave = $3
        WHERE id_detalle = $4
        `,
        [m.dia_semana, m.id_bloque, m.id_aeronave, m.id_detalle]
      );
    }

    await client.query("COMMIT");
    res.json({ message: "Cambios guardados correctamente" });

  } catch (e) {
    await client.query("ROLLBACK");

    if (e.code === "23505") {
      return res.status(409).json({
        message: "Conflicto: ese bloque ya está ocupado"
      });
    }

    console.error("guardarCambios PROGRAMACION:", e);
    res.status(500).json({ message: "Error al guardar cambios" });

  } finally {
    client.release();
  }
};
