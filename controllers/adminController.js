const db = require("../config/db");
const { logAuditoria } = require("../utils/auditoria");
const { pushOutbox } = require("../utils/outbox");
const { dispatchWebhook } = require("../utils/webhookDispatcher");

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
  const user = requireAdmin(req, res);
  if (!user) return;

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

    if (semanaRes.rows.length === 0) {
      throw new Error("No existe semana para publicar");
    }

    await client.query(
      `
      SELECT 1
      FROM semana_vuelo
      WHERE id_semana = $1
      FOR UPDATE
      `,
      [semanaRes.rows[0].id_semana]
    );

    const { id_semana, fecha_inicio, fecha_fin } = semanaRes.rows[0];

    await client.query(
      `
      UPDATE semana_vuelo
      SET publicada = true,
          fecha_publicacion = now()
      WHERE id_semana = $1
      `,
      [id_semana]
    );

    await client.query(
      `
      UPDATE solicitud_semana
      SET estado = 'PUBLICADO',
          fecha_actualizacion = now()
      WHERE id_semana = $1
      `,
      [id_semana]
    );

    await client.query(
      `
      DELETE FROM vuelo
      WHERE id_semana = $1
      `,
      [id_semana]
    );

    await client.query(
      `
      INSERT INTO vuelo (
        id_detalle,
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
        sv.id_detalle,
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
      `,
      [id_semana]
    );

    const vuelosRes = await client.query(
      `
      SELECT
        v.id_vuelo,
        v.id_semana,
        v.dia_semana,
        v.id_bloque,
        bh.hora_inicio,
        bh.hora_fin,
        a.codigo AS aeronave_codigo,

        ua.nombre AS alumno_nombre,
        ua.apellido AS alumno_apellido,

        ui.nombre AS instructor_nombre,
        ui.apellido AS instructor_apellido

      FROM vuelo v
      JOIN bloque_horario bh ON bh.id_bloque = v.id_bloque
      JOIN aeronave a ON a.id_aeronave = v.id_aeronave

      JOIN alumno al ON al.id_alumno = v.id_alumno
      JOIN usuario ua ON ua.id_usuario = al.id_usuario

      JOIN instructor i ON i.id_instructor = v.id_instructor
      JOIN usuario ui ON ui.id_usuario = i.id_usuario

      WHERE v.id_semana = $1
      ORDER BY v.dia_semana, bh.hora_inicio, a.codigo
      `,
      [id_semana]
    );

    const vuelos = vuelosRes.rows.map((row) => ({
      id_vuelo: row.id_vuelo,
      id_semana: row.id_semana,
      dia_semana: row.dia_semana,
      dia_nombre:
        row.dia_semana === 1
          ? "LUNES"
          : row.dia_semana === 2
          ? "MARTES"
          : row.dia_semana === 3
          ? "MIERCOLES"
          : row.dia_semana === 4
          ? "JUEVES"
          : row.dia_semana === 5
          ? "VIERNES"
          : row.dia_semana === 6
          ? "SABADO"
          : "N/A",
      id_bloque: row.id_bloque,
      hora_inicio: row.hora_inicio,
      hora_fin: row.hora_fin,
      bloque: `${row.hora_inicio} - ${row.hora_fin}`,
      aeronave: row.aeronave_codigo,
      alumno: `${row.alumno_nombre} ${row.alumno_apellido}`,
      instructor: `${row.instructor_nombre} ${row.instructor_apellido}`,
    }));

    const payloadSemanaPublicada = {
      id_semana,
      fecha_inicio,
      fecha_fin,
      publicado_por: {
        id_usuario: user.id_usuario,
        rol: user.rol,
      },
      total_vuelos: vuelos.length,
      vuelos,
    };

    await logAuditoria(client, {
      accion: "PUBLICAR_SEMANA",
      entidad: "semana_vuelo",
      id_entidad: id_semana,
      id_semana: id_semana,
      actor: user,
      req,
      descripcion: `Semana publicada: ${id_semana}`,
      metadata: {
        fecha_inicio,
        fecha_fin,
        total_vuelos: vuelos.length,
      },
    });

    await pushOutbox(client, {
      tipo: "SEMANA_PUBLICADA",
      payload: payloadSemanaPublicada,
    });

    const nuevaFechaInicio = new Date(fecha_inicio);
    nuevaFechaInicio.setDate(nuevaFechaInicio.getDate() + 7);

    const nuevaFechaFin = new Date(fecha_fin);
    nuevaFechaFin.setDate(nuevaFechaFin.getDate() + 7);

    const existeRes = await client.query(
      `
      SELECT 1
      FROM semana_vuelo
      WHERE fecha_inicio = $1
      `,
      [nuevaFechaInicio]
    );

    if (existeRes.rows.length === 0) {
      await client.query(
        `
        INSERT INTO semana_vuelo (fecha_inicio, fecha_fin, publicada)
        VALUES ($1, $2, false)
        `,
        [nuevaFechaInicio, nuevaFechaFin]
      );
    }

    await client.query("COMMIT");

    await dispatchWebhook("SEMANA_PUBLICADA", payloadSemanaPublicada);

    res.json({
      message: "Semana publicada y vuelos generados correctamente",
      total_vuelos: vuelos.length,
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
    if (week === "current") idSemana = await getCurrentSemanaId(db);
    else idSemana = await getNextSemanaId(db);

    if (!idSemana) return res.json([]);

    const result = await db.query(
      `
      SELECT
        sv.id_detalle,
        sv.id_solicitud,
        ss.estado AS estado_solicitud,

        v.id_vuelo,
        v.estado AS estado_vuelo,
        COALESCE(v.estado, ss.estado) AS estado_mostrar,

        sv.id_semana,
        sv.dia_semana,
        sv.id_bloque,
        b.hora_inicio,
        b.hora_fin,

        sv.id_aeronave,
        ae.modelo AS aeronave_modelo,
        ae.codigo AS aeronave_codigo,

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

      LEFT JOIN vuelo v
        ON v.id_detalle = sv.id_detalle
       AND v.id_semana = sv.id_semana

      WHERE sv.id_semana = $1
      ORDER BY b.hora_inicio, sv.dia_semana, ae.modelo
      `,
      [idSemana]
    );

    res.json(result.rows);
  } catch (e) {
    console.error("Error getCalendario (ADMIN):", e);
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

    const { moves } = req.body;

    if (!Array.isArray(moves) || moves.length === 0) {
      return res.status(400).json({ message: "No hay movimientos" });
    }

    const semanaRes = await client.query(
      `
      SELECT w.id_semana, w.publicada
      FROM solicitud_vuelo sv
      JOIN semana_vuelo w ON w.id_semana = sv.id_semana
      WHERE sv.id_detalle = $1
      `,
      [moves[0].id_detalle]
    );

    if (semanaRes.rows.length === 0) {
      return res.status(404).json({ message: "Semana no encontrada" });
    }

    const { id_semana, publicada } = semanaRes.rows[0];

    await client.query("BEGIN");

    const idsMovidos = moves.map((m) => m.id_detalle);

    const infoMovidosRes = await client.query(
      `
      SELECT
        sv.id_detalle,
        ss.id_alumno,
        al.id_instructor
      FROM solicitud_vuelo sv
      JOIN solicitud_semana ss ON ss.id_solicitud = sv.id_solicitud
      JOIN alumno al ON al.id_alumno = ss.id_alumno
      WHERE sv.id_detalle = ANY($1::int[])
      `,
      [idsMovidos]
    );

    const infoPorDetalle = new Map(
      infoMovidosRes.rows.map((r) => [Number(r.id_detalle), r])
    );

    const destinosBloqueAeronave = new Set();
    const destinosAlumno = new Set();
    const destinosInstructor = new Set();

    for (const m of moves) {
      const info = infoPorDetalle.get(Number(m.id_detalle));
      if (!info) {
        throw new Error(`No se encontró información del detalle ${m.id_detalle}`);
      }

      const keyBloqueAeronave = `${m.dia_semana}-${m.id_bloque}-${m.id_aeronave}`;
      if (destinosBloqueAeronave.has(keyBloqueAeronave)) {
        throw Object.assign(
          new Error("Dos vuelos no pueden quedar en el mismo bloque y aeronave"),
          { code: "23505" }
        );
      }
      destinosBloqueAeronave.add(keyBloqueAeronave);

      const keyAlumno = `${info.id_alumno}-${m.dia_semana}-${m.id_bloque}`;
      if (destinosAlumno.has(keyAlumno)) {
        throw Object.assign(
          new Error("Un alumno no puede tener dos vuelos en el mismo horario"),
          { code: "23506" }
        );
      }
      destinosAlumno.add(keyAlumno);

      const keyInstructor = `${info.id_instructor}-${m.dia_semana}-${m.id_bloque}`;
      if (destinosInstructor.has(keyInstructor)) {
        throw Object.assign(
          new Error("Un instructor no puede tener dos vuelos en el mismo horario"),
          { code: "23507" }
        );
      }
      destinosInstructor.add(keyInstructor);
    }

    for (let idx = 0; idx < moves.length; idx++) {
      const m = moves[idx];

      await client.query(
        `
        UPDATE solicitud_vuelo
        SET dia_semana = 0,
            id_bloque = $1
        WHERE id_detalle = $2
        `,
        [idx + 1, m.id_detalle]
      );
    }

    for (const m of moves) {
      const info = infoPorDetalle.get(Number(m.id_detalle));

      const ocupadoBloqueAeronave = await client.query(
        `
        SELECT 1
        FROM solicitud_vuelo
        WHERE id_semana = $1
          AND dia_semana = $2
          AND id_bloque = $3
          AND id_aeronave = $4
          AND id_detalle <> ALL($5::int[])
        LIMIT 1
        `,
        [id_semana, m.dia_semana, m.id_bloque, m.id_aeronave, idsMovidos]
      );

      if (ocupadoBloqueAeronave.rows.length > 0) {
        throw Object.assign(
          new Error("Ese bloque y aeronave ya está ocupado"),
          { code: "23505" }
        );
      }

      const ocupadoAlumno = await client.query(
        `
        SELECT 1
        FROM solicitud_vuelo sv
        JOIN solicitud_semana ss ON ss.id_solicitud = sv.id_solicitud
        WHERE sv.id_semana = $1
          AND ss.id_alumno = $2
          AND sv.dia_semana = $3
          AND sv.id_bloque = $4
          AND sv.id_detalle <> ALL($5::int[])
        LIMIT 1
        `,
        [id_semana, info.id_alumno, m.dia_semana, m.id_bloque, idsMovidos]
      );

      if (ocupadoAlumno.rows.length > 0) {
        throw Object.assign(
          new Error("El alumno ya tiene un vuelo en ese horario"),
          { code: "23506" }
        );
      }

      const ocupadoInstructor = await client.query(
        `
        SELECT 1
        FROM solicitud_vuelo sv
        JOIN solicitud_semana ss ON ss.id_solicitud = sv.id_solicitud
        JOIN alumno al ON al.id_alumno = ss.id_alumno
        WHERE sv.id_semana = $1
          AND al.id_instructor = $2
          AND sv.dia_semana = $3
          AND sv.id_bloque = $4
          AND sv.id_detalle <> ALL($5::int[])
        LIMIT 1
        `,
        [id_semana, info.id_instructor, m.dia_semana, m.id_bloque, idsMovidos]
      );

      if (ocupadoInstructor.rows.length > 0) {
        throw Object.assign(
          new Error("El instructor ya tiene un vuelo en ese horario"),
          { code: "23507" }
        );
      }
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

    for (const m of moves) {
      await client.query(
        `
        UPDATE vuelo
        SET dia_semana = $1,
            id_bloque = $2,
            id_aeronave = $3
        WHERE id_detalle = $4
        `,
        [m.dia_semana, m.id_bloque, m.id_aeronave, m.id_detalle]
      );
    }

    await logAuditoria(client, {
      accion: "GUARDAR_CAMBIOS",
      entidad: "calendario",
      id_entidad: null,
      id_semana,
      actor: user,
      req,
      descripcion: `Admin guardó ${moves.length} movimientos`,
      metadata: {
        moves,
        semana_publicada: publicada
      }
    });

    if (publicada) {
      await pushOutbox(client, {
        tipo: "VUELO_REPROGRAMADO",
        payload: {
          id_semana,
          moves,
          hecho_por: {
            id_usuario: user.id_usuario,
            rol: user.rol
          }
        }
      });
    }

    await client.query("COMMIT");

    if (publicada) {
      await dispatchWebhook("VUELO_REPROGRAMADO", {
        id_semana,
        moves,
        hecho_por: {
          id_usuario: user.id_usuario,
          rol: user.rol
        }
      });
    }

    res.json({
      message: publicada
        ? "Cambios guardados correctamente"
        : "Cambios guardados correctamente (sin notificación porque la semana aún no está publicada)"
    });
  } catch (e) {
    await client.query("ROLLBACK");

    if (e.code === "23505") {
      return res.status(409).json({
        message: "Conflicto: ese bloque y aeronave ya están ocupados"
      });
    }

    if (e.code === "23506") {
      return res.status(409).json({
        message: "Conflicto: el alumno ya tiene un vuelo en ese horario"
      });
    }

    if (e.code === "23507") {
      return res.status(409).json({
        message: "Conflicto: el instructor ya tiene un vuelo en ese horario"
      });
    }

    console.error("guardarCambios ADMIN:", e);
    res.status(500).json({ message: "Error guardando cambios" });
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

exports.cancelarVueloAdmin = async (req, res) => {
  const client = await db.connect();

  try {
    const user = requireAdmin(req, res);
    if (!user) return;

    const { id_vuelo } = req.params;
    const { motivo = null } = req.body || {};

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

    const pastCheck = await client.query(
      `SELECT (now() < $1::timestamp) AS permitido`,
      [vuelo.fecha_hora_vuelo]
    );

    if (!pastCheck.rows[0]?.permitido) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        message: "No se puede cancelar un vuelo que ya ocurrió",
        fecha_hora_vuelo: vuelo.fecha_hora_vuelo,
      });
    }

    const permitido24h = !!timeCheck.rows[0]?.permitido;

    if (!permitido24h) {
      const m = (motivo ?? "").toString().trim();
      if (m.length < 5) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message:
            "Para cancelar con menos de 24 horas, el ADMIN debe indicar un motivo (mín. 5 caracteres).",
          fecha_hora_vuelo: vuelo.fecha_hora_vuelo,
        });
      }
    }

    await client.query(
      `UPDATE vuelo SET estado = 'CANCELADO' WHERE id_vuelo = $1`,
      [id_vuelo]
    );

    await logAuditoria(client, {
      accion: "CANCELAR_VUELO",
      entidad: "vuelo",
      id_entidad: vuelo.id_vuelo,
      id_semana: vuelo.id_semana,
      actor: user,
      req,
      descripcion: `Cancelación de vuelo por ADMIN (id_vuelo=${vuelo.id_vuelo})`,
      metadata: {
        motivo: motivo ?? null,
        id_alumno: vuelo.id_alumno,
        id_instructor: vuelo.id_instructor,
        id_aeronave: vuelo.id_aeronave,
        dia_semana: vuelo.dia_semana,
        id_bloque: vuelo.id_bloque,
        fecha_hora_vuelo: vuelo.fecha_hora_vuelo,
        override_24h: !permitido24h,
      },
    });

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
        motivo: motivo ?? null,
        cancelado_por: {
          id_usuario: user.id_usuario,
          rol: user.rol
        },
        destino_notificacion: "ALUMNO",
      },
    });

    await client.query("COMMIT");

    await dispatchWebhook("VUELO_CANCELADO", {
      id_vuelo: vuelo.id_vuelo,
      id_semana: vuelo.id_semana,
      id_alumno: vuelo.id_alumno,
      id_instructor: vuelo.id_instructor,
      id_aeronave: vuelo.id_aeronave,
      dia_semana: vuelo.dia_semana,
      id_bloque: vuelo.id_bloque,
      fecha_hora_vuelo: vuelo.fecha_hora_vuelo,
      motivo: motivo ?? null,
      cancelado_por: {
        id_usuario: user.id_usuario,
        rol: user.rol
      },
      destino_notificacion: "ALUMNO",
    });

    return res.json({ message: "Vuelo cancelado" });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Error cancelarVuelo ADMIN:", e);
    return res.status(500).json({ message: "Error cancelando vuelo" });
  } finally {
    client.release();
  }
};