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
const getCurrentSemanaId = async (db) => {
  const res = await db.query(`
    SELECT id_semana
    FROM semana_vuelo
    WHERE CURRENT_DATE BETWEEN fecha_inicio AND fecha_fin
    LIMIT 1
  `);
  return res.rows[0]?.id_semana;
};

exports.getSemanas = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        id_semana,
        fecha_inicio,
        fecha_fin,
        publicada,
        fecha_publicacion,
        CASE
          WHEN CURRENT_DATE BETWEEN fecha_inicio AND fecha_fin THEN 'ACTUAL'
          WHEN fecha_inicio > CURRENT_DATE THEN 'SIGUIENTE'
          ELSE 'PASADA'
        END AS tipo
      FROM semana_vuelo
      ORDER BY fecha_inicio
    `);

    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Error obteniendo semanas" });
  }
};

exports.publicarSemana = async (req, res) => {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const semanaRes = await client.query(`
      SELECT id_semana
      FROM semana_vuelo
      WHERE fecha_inicio > CURRENT_DATE
      ORDER BY fecha_inicio
      LIMIT 1
      FOR UPDATE
    `);

    if (semanaRes.rows.length === 0) {
      throw new Error("No existe semana siguiente");
    }

    const idSemana = semanaRes.rows[0].id_semana;

    await client.query(`
      UPDATE semana_vuelo
      SET publicada = true,
          fecha_publicacion = now()
      WHERE id_semana = $1
    `, [idSemana]);

    await client.query(`
      UPDATE solicitud_semana
      SET estado = 'PUBLICADO'
      WHERE id_semana = $1
    `, [idSemana]);

    await client.query("COMMIT");

    res.json({ message: "Semana publicada correctamente" });

  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(400).json({ message: e.message });
  } finally {
    client.release();
  }
};

exports.asegurarSemanaFutura = async (req, res) => {
  try {
    const lastRes = await db.query(`
      SELECT fecha_fin
      FROM semana_vuelo
      ORDER BY fecha_fin DESC
      LIMIT 1
    `);

    let startDate;

    if (lastRes.rows.length === 0) {
      startDate = new Date();
    } else {
      startDate = new Date(lastRes.rows[0].fecha_fin);
      startDate.setDate(startDate.getDate() + 1);
    }

    const day = startDate.getDay();
    const diff = (day + 6) % 7;
    startDate.setDate(startDate.getDate() - diff);

    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);

    await db.query(`
      INSERT INTO semana_vuelo (fecha_inicio, fecha_fin)
      VALUES ($1, $2)
    `, [startDate, endDate]);

    res.json({ message: "Semana futura creada" });

  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Error creando semana futura" });
  }
};

exports.getAeronavesActivas = async (req, res) => {
  try {

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

exports.getCalendario = async (req, res) => {
  try {
    const { week = "next" } = req.query;

    let idSemana;
    if (week === "current") {
      idSemana = await getCurrentSemanaId(db);
    } else {
      idSemana = await getNextSemanaId(db);
    }

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


exports.getBloquesHorario = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        id_bloque,
        hora_inicio,
        hora_fin,
        es_almuerzo
      FROM bloque_horario
      ORDER BY hora_inicio
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Error bloques horario:", error);
    res.status(500).json({ message: "Error obtener bloques" });
  }
};

exports.guardarCambios = async (req, res) => {
  const { moves } = req.body;

  if (!Array.isArray(moves) || moves.length === 0) {
    return res.status(400).json({ message: "No hay movimientos" });
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    for (const m of moves) {
      await client.query(
        `
        UPDATE solicitud_vuelo
        SET
          dia_semana = $1,
          id_bloque = $2,
          id_aeronave = $3
        WHERE id_detalle = $4
        `,
        [
          m.dia_semana,
          m.id_bloque,
          m.id_aeronave,
          m.id_detalle,
        ]
      );
    }

    await client.query("COMMIT");
    res.json({ message: "Cambios guardados correctamente" });

  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Error guardarCambios admin:", e);
    res.status(500).json({ message: "Error guardando cambios" });
  } finally {
    client.release();
  }
};
