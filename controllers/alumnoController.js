const db = require("../config/db");

function formatLocalDateYYYYMMDD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getMondayLocal(weekOffset = 0) {
  const today = new Date();
  const monday = new Date(today);

  const diff = (today.getDay() + 6) % 7; 
  monday.setDate(today.getDate() - diff);

  monday.setDate(monday.getDate() + weekOffset * 7);

  monday.setHours(12, 0, 0, 0);

  return monday;
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
        sv.dia_semana,
        b.hora_inicio,
        b.hora_fin,
        ae.codigo AS aeronave,
        ss.estado
      FROM solicitud_vuelo sv
      JOIN solicitud_semana ss ON ss.id_solicitud = sv.id_solicitud
      JOIN bloque_horario b ON b.id_bloque = sv.id_bloque
      JOIN aeronave ae ON ae.id_aeronave = sv.id_aeronave
      WHERE ss.id_alumno = $1
        AND sv.id_semana = $2
      ORDER BY b.hora_inicio, sv.dia_semana
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


