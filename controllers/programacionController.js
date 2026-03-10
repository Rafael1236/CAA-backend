const db = require("../config/db");
const { logAuditoria } = require("../utils/auditoria");
const { pushOutbox } = require("../utils/outbox");

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

    const { week = "next" } = req.query;
    if (!["current", "next"].includes(week)) {
      return res.status(400).json({ message: "week inválido (current|next)" });
    }

    let idSemana = null;
    if (week === "current") {
      idSemana = await getCurrentSemanaId(db); 
    } else {
      idSemana = await getNextSemanaId(db); 
    }

    if (!idSemana) return res.json([]);

    if (week === "current") {
      const result = await db.query(
        `
        SELECT
          v.id_vuelo,
          v.id_detalle,
          v.id_semana,
          v.dia_semana,
          v.id_bloque,
          b.hora_inicio,
          b.hora_fin,

          v.id_aeronave,
          ae.modelo AS aeronave_modelo,

          v.id_alumno,
          u_al.nombre || ' ' || u_al.apellido AS alumno_nombre,

          v.id_instructor,
          u_ins.nombre || ' ' || u_ins.apellido AS instructor_nombre,

          v.estado AS estado_vuelo,

          'PUBLICADO' AS estado_solicitud,
          v.estado AS estado_mostrar
        FROM vuelo v
        JOIN bloque_horario b ON b.id_bloque = v.id_bloque
        JOIN aeronave ae ON ae.id_aeronave = v.id_aeronave

        JOIN alumno al ON al.id_alumno = v.id_alumno
        JOIN usuario u_al ON u_al.id_usuario = al.id_usuario

        JOIN instructor i ON i.id_instructor = v.id_instructor
        JOIN usuario u_ins ON u_ins.id_usuario = i.id_usuario

        WHERE v.id_semana = $1
        ORDER BY b.hora_inicio, v.dia_semana, ae.modelo
        `,
        [idSemana]
      );

      return res.json(result.rows);
    }

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
        u_ins.nombre || ' ' || u_ins.apellido AS instructor_nombre,

        NULL::int AS id_vuelo,
        NULL::text AS estado_vuelo,

        ss.estado AS estado_mostrar
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

    return res.json(result.rows);
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
            id_bloque = 1
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

exports.cancelarVuelo = async (req, res) => {
  const client = await db.connect();

  try {
    const user = requireProgramacion(req, res);
    if (!user) return;

    const { id_vuelo } = req.params;

    await client.query("BEGIN");

    const q = await client.query(
      `
      SELECT 
        v.id_vuelo,
        v.estado,
        v.id_alumno,
        v.id_instructor,
        v.id_aeronave,
        v.id_semana,
        sv.fecha_inicio,
        v.dia_semana,
        v.id_bloque,
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

    if (vuelo.estado === "CANCELADO") {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "El vuelo ya está cancelado" });
    }

    const timeCheck = await client.query(
      `SELECT (now() <= ($1::timestamp - interval '24 hour')) AS permitido`,
      [vuelo.fecha_hora_vuelo]
    );

    if (!timeCheck.rows[0]?.permitido) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        message: "Solo podés cancelar con más de 24 horas de anticipación",
        fecha_hora_vuelo: vuelo.fecha_hora_vuelo,
      });
    }

    await client.query(`UPDATE vuelo SET estado = 'CANCELADO' WHERE id_vuelo = $1`, [
      id_vuelo,
    ]);

    await logAuditoria(client, {
      accion: "CANCELAR_VUELO",
      entidad: "vuelo",
      id_entidad: vuelo.id_vuelo,
      id_semana: vuelo.id_semana,
      actor: user,
      req,
      descripcion: `Cancelación de vuelo por PROGRAMACION (id_vuelo=${vuelo.id_vuelo})`,
      metadata: {
        id_alumno: vuelo.id_alumno,
        id_instructor: vuelo.id_instructor,
        id_aeronave: vuelo.id_aeronave,
        dia_semana: vuelo.dia_semana,
        id_bloque: vuelo.id_bloque,
        fecha_hora_vuelo: vuelo.fecha_hora_vuelo,
      },
    });

    await client.query("COMMIT");

    try {
      await pushOutbox(client, {
        tipo: "VUELO_CANCELADO",
        payload: {
          id_vuelo: vuelo.id_vuelo,
          id_semana: vuelo.id_semana,
          id_alumno: vuelo.id_alumno,
          id_instructor: vuelo.id_instructor,
          id_aeronave: vuelo.id_aeronave,
          dia_semana: vuelo.dia_semana,
          id_bloque: vuelo.id_bloque,
          fecha_hora_vuelo: vuelo.fecha_hora_vuelo,
          cancelado_por: { id_usuario: user.id_usuario, rol: user.rol },
          destino_notificacion: "ALUMNO",
        },
      });
    } catch (err) {
      console.error("Outbox falló (no se revierte cancelación):", err);
    }

    return res.json({ message: "Vuelo cancelado" });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Error cancelarVuelo PROGRAMACION:", e);
    return res.status(500).json({ message: "Error cancelando vuelo" });
  } finally {
    client.release();
  }
};