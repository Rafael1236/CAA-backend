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

function requireAdmin(req, res) {
  const userHeader = req.headers["x-user"];
  if (!userHeader) {
    res.status(401).json({ message: "No autenticado" });
    return null;
  }
  const user = JSON.parse(userHeader);
  if (user.rol !== "ADMIN") {
    res.status(403).json({ message: "Acceso denegado" });
    return null;
  }
  return user;
}

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
      SELECT w.id_semana, w.fecha_inicio, w.fecha_fin
      FROM semana_vuelo w
      JOIN solicitud_semana ss ON ss.id_semana = w.id_semana
      WHERE w.publicada = false
        AND ss.estado IN ('BORRADOR', 'EN_REVISION')
      GROUP BY w.id_semana, w.fecha_inicio, w.fecha_fin
      ORDER BY w.fecha_inicio
      LIMIT 1
    `);

    await client.query(`
      SELECT 1
      FROM semana_vuelo
      WHERE id_semana = $1
      FOR UPDATE
    `, [semanaRes.rows[0].id_semana]);


    if (semanaRes.rows.length === 0) {
      throw new Error("No existe semana para publicar");
    }

    const { id_semana, fecha_inicio, fecha_fin } = semanaRes.rows[0];

    await client.query(`
      UPDATE semana_vuelo
      SET publicada = true,
          fecha_publicacion = now()
      WHERE id_semana = $1
    `, [id_semana]);

    await client.query(`
      UPDATE solicitud_semana
      SET estado = 'PUBLICADO',
          fecha_actualizacion = now()
      WHERE id_semana = $1
    `, [id_semana]);

    await client.query(`
      DELETE FROM vuelo
      WHERE id_semana = $1
    `, [id_semana]);

    await client.query(`
      INSERT INTO vuelo (
        id_semana,
        id_alumno,
        id_instructor,
        id_aeronave,
        dia_semana,
        id_bloque,
        estado,
        creado_por
      )
      SELECT
        sv.id_semana,
        ss.id_alumno,
        al.id_instructor,
        sv.id_aeronave,
        sv.dia_semana,
        sv.id_bloque,
        'PUBLICADO',
        'ADMIN'
      FROM solicitud_vuelo sv
      JOIN solicitud_semana ss ON ss.id_solicitud = sv.id_solicitud
      JOIN alumno al ON al.id_alumno = ss.id_alumno
      WHERE sv.id_semana = $1
    `, [id_semana]);

    const nuevaFechaInicio = new Date(fecha_inicio);
    nuevaFechaInicio.setDate(nuevaFechaInicio.getDate() + 7);

    const nuevaFechaFin = new Date(fecha_fin);
    nuevaFechaFin.setDate(nuevaFechaFin.getDate() + 7);

    const existeRes = await client.query(`
      SELECT 1
      FROM semana_vuelo
      WHERE fecha_inicio = $1
    `, [nuevaFechaInicio]);

    if (existeRes.rows.length === 0) {
      await client.query(`
        INSERT INTO semana_vuelo (fecha_inicio, fecha_fin, publicada)
        VALUES ($1, $2, false)
      `, [nuevaFechaInicio, nuevaFechaFin]);
    }

    await client.query("COMMIT");

    res.json({
      message: "Semana publicada y vuelos generados correctamente"
    });

  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Error publicarSemana:", e);
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
    const user = requireAdmin(req, res);
    if (!user) return;


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
  const client = await db.connect();

  try {
    const user = requireAdmin(req, res);
    if (!user) return;

    console.log("BODY RECIBIDO ADMIN:", req.body);

    const { moves } = req.body;

    if (!Array.isArray(moves) || moves.length === 0) {
      return res.status(400).json({ message: "No hay movimientos" });
    }

    await client.query("BEGIN");

    for (const m of moves) {
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

    for (const m of moves) {
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
    console.error("guardarCambios ADMIN:", e);
    res.status(500).json({ message: "Error guardando cambios" });

  } finally {
    client.release();
  }
};