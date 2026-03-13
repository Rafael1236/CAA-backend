const db = require("../config/db");

function requireN8nApiKey(req, res) {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || apiKey !== process.env.N8N_API_KEY) {
    res.status(401).json({ message: "No autorizado" });
    return false;
  }
  return true;
}

exports.getPendientes = async (req, res) => {
  try {
    if (!requireN8nApiKey(req, res)) return;

    const limit = Math.min(Number(req.query.limit || 20), 100);

    const result = await db.query(
      `
      SELECT
        id_outbox,
        tipo,
        para_correo,
        para_id_usuario,
        payload,
        creado_en
      FROM notificacion_outbox
      WHERE procesado = false
      ORDER BY creado_en ASC
      LIMIT $1
      `,
      [limit]
    );

    res.json(result.rows);
  } catch (e) {
    console.error("Error getPendientes:", e);
    res.status(500).json({ message: "Error obteniendo pendientes" });
  }
};

exports.marcarProcesado = async (req, res) => {
  try {
    if (!requireN8nApiKey(req, res)) return;

    const { id } = req.params;

    await db.query(
      `
      UPDATE notificacion_outbox
      SET procesado = true,
          procesado_en = now(),
          error = NULL
      WHERE id_outbox = $1
      `,
      [id]
    );

    res.json({ message: "Marcado como procesado" });
  } catch (e) {
    console.error("Error marcarProcesado:", e);
    res.status(500).json({ message: "Error marcando procesado" });
  }
};

exports.marcarError = async (req, res) => {
  try {
    if (!requireN8nApiKey(req, res)) return;

    const { id } = req.params;
    const { error } = req.body;

    await db.query(
      `
      UPDATE notificacion_outbox
      SET error = $1
      WHERE id_outbox = $2
      `,
      [error || "Error desconocido", id]
    );

    res.json({ message: "Error registrado" });
  } catch (e) {
    console.error("Error marcarError:", e);
    res.status(500).json({ message: "Error registrando error" });
  }
};