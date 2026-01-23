const db = require("../config/db");

exports.getAeronavesPermitidas = async (req, res) => {
  try {
    const userHeader = req.headers["x-user"];
    if (!userHeader) {
      return res.status(401).json({ message: "Usuario no autenticado" });
    }

    const user = JSON.parse(userHeader);

    const licenciaRes = await db.query(
      `
      SELECT id_licencia
      FROM alumno
      WHERE id_usuario = $1
      `,
      [user.id_usuario]
    );

    if (licenciaRes.rows.length === 0) {
      return res.status(404).json({ message: "Alumno no encontrado" });
    }

    const idLicencia = licenciaRes.rows[0].id_licencia;

    const aeronavesRes = await db.query(
      `
      SELECT
        a.id_aeronave,
        a.codigo,
        a.modelo,
        a.tipo
      FROM licencia_aeronave la
      JOIN aeronave a ON a.id_aeronave = la.id_aeronave
      WHERE la.id_licencia = $1
        AND a.activa = true
      ORDER BY a.codigo
      `,
      [idLicencia]
    );

    res.json(aeronavesRes.rows);
  } catch (error) {
    console.error("Error obtener aeronaves:", error);
    res.status(500).json({ message: "Error al obtener aeronaves" });
  }
};

exports.getMisSolicitudes = async (req, res) => {
  try {
    const user = JSON.parse(req.headers["x-user"]);
    const { week } = req.query;

    if (week !== "next") {
      return res.status(400).json({ message: "Solo se permite la semana siguiente" });
    }

    const alumnoRes = await db.query(
      "SELECT id_alumno FROM alumno WHERE id_usuario = $1",
      [user.id_usuario]
    );
    if (alumnoRes.rows.length === 0) return res.json(null);

    const idAlumno = alumnoRes.rows[0].id_alumno;

    const semanaRes = await db.query(`
      SELECT id_semana
      FROM semana_vuelo
      WHERE fecha_inicio > CURRENT_DATE
      ORDER BY fecha_inicio
      LIMIT 1
    `);
    if (semanaRes.rows.length === 0) return res.json(null);

    const idSemana = semanaRes.rows[0].id_semana;

    const solicitudRes = await db.query(
      `
      SELECT id_solicitud, estado
      FROM solicitud_semana
      WHERE id_alumno = $1 AND id_semana = $2
      `,
      [idAlumno, idSemana]
    );

    if (solicitudRes.rows.length === 0) {
      return res.json({ estado: "BORRADOR", vuelos: [] });
    }

    const { id_solicitud, estado } = solicitudRes.rows[0];

    const vuelosRes = await db.query(
      `
      SELECT dia_semana, id_bloque, id_aeronave
      FROM solicitud_vuelo
      WHERE id_solicitud = $1
      `,
      [id_solicitud]
    );

    res.json({ estado, vuelos: vuelosRes.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Error obtener solicitudes" });
  }
};

exports.guardarSolicitud = async (req, res) => {
  const client = await db.connect();
  try {
    const user = JSON.parse(req.headers["x-user"]);
    const { vuelos } = req.body;
    const { week } = req.query;

    if (week !== "next") {
      return res.status(400).json({ message: "Solo se permite la semana siguiente" });
    }

    if (!Array.isArray(vuelos) || vuelos.length === 0 || vuelos.length > 3) {
      return res.status(400).json({ message: "Cantidad inválida de vuelos" });
    }

    const alumnoRes = await client.query(
      "SELECT id_alumno, id_licencia FROM alumno WHERE id_usuario = $1",
      [user.id_usuario]
    );
    if (alumnoRes.rows.length === 0) {
      return res.status(403).json({ message: "No es alumno" });
    }

    const { id_alumno, id_licencia } = alumnoRes.rows[0];

    const semanaRes = await client.query(`
      SELECT id_semana, publicada
      FROM semana_vuelo
      WHERE fecha_inicio > CURRENT_DATE
      ORDER BY fecha_inicio
      LIMIT 1
    `);

    if (semanaRes.rows.length === 0) {
      return res.status(400).json({ message: "Semana no encontrada" });
    }

    const { id_semana, publicada } = semanaRes.rows[0];

    if (publicada) {
      return res.status(403).json({ message: "Semana ya publicada" });
    }

    await client.query("BEGIN");

    const solicitudRes = await client.query(
      `
      INSERT INTO solicitud_semana (id_semana, id_alumno, estado)
      VALUES ($1,$2,'BORRADOR')
      ON CONFLICT (id_semana, id_alumno)
      DO UPDATE SET fecha_actualizacion = now()
      RETURNING id_solicitud, estado
      `,
      [id_semana, id_alumno]
    );

    const { id_solicitud, estado } = solicitudRes.rows[0];

    if (estado !== "BORRADOR") {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "Solicitud en revisión o publicada" });
    }

    await client.query(
      "DELETE FROM solicitud_vuelo WHERE id_solicitud = $1",
      [id_solicitud]
    );

    for (const v of vuelos) {
      const permitida = await client.query(
        `
        SELECT 1 FROM licencia_aeronave
        WHERE id_licencia = $1 AND id_aeronave = $2
        `,
        [id_licencia, v.id_aeronave]
      );
      if (permitida.rows.length === 0) {
        throw new Error("Aeronave no permitida");
      }

      await client.query(
        `
        INSERT INTO solicitud_vuelo
          (id_solicitud, id_semana, dia_semana, id_bloque, id_aeronave)
        VALUES ($1,$2,$3,$4,$5)
        `,
        [id_solicitud, id_semana, v.dia_semana, v.id_bloque, v.id_aeronave]
      );
    }

    await client.query("COMMIT");
    res.json({ message: "Solicitud guardada correctamente" });

  } catch (e) {
    await client.query("ROLLBACK");

    if (e.code === "23505") {
      return res.status(409).json({
        message: "Uno de los bloques ya fue tomado por otro alumno"
      });
    }

    console.error(e);
    res.status(500).json({ message: "Error al guardar solicitud" });
  } finally {
    client.release();
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

exports.getBloquesOcupados = async (req, res) => {
  try {
    const { week } = req.query;

    const semanaRes = await db.query(`
      SELECT id_semana
      FROM semana_vuelo
      WHERE fecha_inicio > CURRENT_DATE
      ORDER BY fecha_inicio
      LIMIT 1
    `);

    if (semanaRes.rows.length === 0) return res.json([]);

    const idSemana = semanaRes.rows[0].id_semana;

    const result = await db.query(
      `
      SELECT dia_semana, id_bloque, id_aeronave
      FROM solicitud_vuelo
      WHERE id_semana = $1
      `,
      [idSemana]
    );

    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Error bloques ocupados" });
  }
};
