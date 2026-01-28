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
        ae.codigo AS aeronave_codigo,
        ae.modelo AS aeronave_modelo,

        ss.id_alumno,
        u.nombre || ' ' || u.apellido AS alumno_nombre
      FROM solicitud_vuelo sv
      JOIN solicitud_semana ss ON ss.id_solicitud = sv.id_solicitud
      JOIN bloque_horario b ON b.id_bloque = sv.id_bloque
      JOIN aeronave ae ON ae.id_aeronave = sv.id_aeronave
      JOIN alumno al ON al.id_alumno = ss.id_alumno
      JOIN usuario u ON u.id_usuario = al.id_usuario
      WHERE sv.id_semana = $1
      ORDER BY b.hora_inicio, sv.dia_semana, ae.codigo
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

exports.moverVuelo = async (req, res) => {
  const client = await db.connect();
  try {
    const user = requireProgramacion(req, res);
    if (!user) return;

    const { id_detalle } = req.params;
    const { dia_semana, id_bloque, id_aeronave } = req.body;

    if (!dia_semana || !id_bloque || !id_aeronave) {
      return res.status(400).json({ message: "Datos incompletos" });
    }

    await client.query("BEGIN");

    const detRes = await client.query(
      `
      SELECT sv.id_solicitud, ss.estado, sv.id_semana
      FROM solicitud_vuelo sv
      JOIN solicitud_semana ss ON ss.id_solicitud = sv.id_solicitud
      WHERE sv.id_detalle = $1
      FOR UPDATE
      `,
      [id_detalle]
    );

    if (detRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Vuelo no encontrado" });
    }

    const { id_solicitud, estado, id_semana } = detRes.rows[0];
    const semanaRes = await client.query(
      `
      SELECT publicada
      FROM semana_vuelo
      WHERE id_semana = $1
      `,
      [id_semana]
    );

    if (semanaRes.rows[0]?.publicada) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        message: "La semana ya está publicada y no puede modificarse",
      });
    }


    if (estado === "PUBLICADO") {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "Solicitud ya publicada" });
    }

    await client.query(
      `
      UPDATE solicitud_vuelo
      SET dia_semana = $1,
          id_bloque = $2,
          id_aeronave = $3
      WHERE id_detalle = $4
      `,
      [dia_semana, id_bloque, id_aeronave, id_detalle]
    );

    await client.query(
      `
      UPDATE solicitud_semana
      SET estado = 'EN_REVISION',
          fecha_actualizacion = now()
      WHERE id_solicitud = $1
      `,
      [id_solicitud]
    );

    await client.query("COMMIT");
    res.json({ message: "Vuelo actualizado", id_solicitud, id_semana });
  } catch (e) {
    await client.query("ROLLBACK");

    if (e.code === "23505") {
      return res.status(409).json({ message: "Bloque ya ocupado" });
    }

    console.error("Error moverVuelo:", e);
    res.status(500).json({ message: "Error mover vuelo" });
  } finally {
    client.release();
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
    const userHeader = req.headers["x-user"];
    if (!userHeader) {
      return res.status(401).json({ message: "No autenticado" });
    }

    const user = JSON.parse(userHeader);
    if (user.rol !== "PROGRAMACION") {
      return res.status(403).json({ message: "Acceso denegado" });
    }

    const { movimientos } = req.body;

    if (!Array.isArray(movimientos) || movimientos.length === 0) {
      return res.status(400).json({ message: "No hay cambios para guardar" });
    }

    await client.query("BEGIN");

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
        message: "Conflicto: uno de los bloques ya fue ocupado"
      });
    }

    console.error("guardarCambios:", e);
    res.status(500).json({ message: "Error al guardar cambios" });

  } finally {
    client.release();
  }
};
