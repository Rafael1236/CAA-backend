const db = require("../config/db");

const EVENTOS_VALIDOS = [
  "SEMANA_PUBLICADA",
  "VUELO_CANCELADO",
  "VUELO_REPROGRAMADO",
];

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

exports.getEventosDisponibles = async (req, res) => {
  const user = requireAdmin(req, res);
  if (!user) return;

  return res.json(EVENTOS_VALIDOS);
};

exports.getWebhooks = async (req, res) => {
  const user = requireAdmin(req, res);
  if (!user) return;

  try {
    const result = await db.query(
      `
      SELECT
        id_webhook,
        nombre,
        url,
        activo,
        timeout_ms,
        creado_en,
        actualizado_en
      FROM webhook_endpoint
      ORDER BY id_webhook DESC
      `
    );

    res.json(result.rows);
  } catch (e) {
    console.error("Error getWebhooks:", e);
    res.status(500).json({ message: "Error obteniendo webhooks" });
  }
};

exports.getWebhookById = async (req, res) => {
  const user = requireAdmin(req, res);
  if (!user) return;

  try {
    const { id } = req.params;

    const webhookRes = await db.query(
      `
      SELECT
        id_webhook,
        nombre,
        url,
        secret_token,
        activo,
        timeout_ms,
        creado_en,
        actualizado_en
      FROM webhook_endpoint
      WHERE id_webhook = $1
      `,
      [id]
    );

    if (webhookRes.rows.length === 0) {
      return res.status(404).json({ message: "Webhook no encontrado" });
    }

    const eventosRes = await db.query(
      `
      SELECT evento, activo
      FROM webhook_evento
      WHERE id_webhook = $1
      ORDER BY evento
      `,
      [id]
    );

    res.json({
      ...webhookRes.rows[0],
      eventos: eventosRes.rows,
    });
  } catch (e) {
    console.error("Error getWebhookById:", e);
    res.status(500).json({ message: "Error obteniendo webhook" });
  }
};

exports.createWebhook = async (req, res) => {
  const user = requireAdmin(req, res);
  if (!user) return;

  const client = await db.connect();

  try {
    const {
      nombre,
      url,
      secret_token = null,
      activo = true,
      timeout_ms = 5000,
      eventos = [],
    } = req.body;

    if (!nombre || !nombre.toString().trim()) {
      return res.status(400).json({ message: "El nombre es obligatorio" });
    }

    if (!url || !url.toString().trim()) {
      return res.status(400).json({ message: "La URL es obligatoria" });
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ message: "La URL no es válida" });
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return res.status(400).json({ message: "La URL debe iniciar con http o https" });
    }

    if (!Array.isArray(eventos)) {
      return res.status(400).json({ message: "Eventos inválidos" });
    }

    for (const ev of eventos) {
      if (!EVENTOS_VALIDOS.includes(ev)) {
        return res.status(400).json({ message: `Evento no permitido: ${ev}` });
      }
    }

    await client.query("BEGIN");

    const insertRes = await client.query(
      `
      INSERT INTO webhook_endpoint (
        nombre,
        url,
        secret_token,
        activo,
        timeout_ms,
        creado_en,
        actualizado_en
      )
      VALUES ($1, $2, $3, $4, $5, now(), now())
      RETURNING id_webhook, nombre, url, secret_token, activo, timeout_ms, creado_en, actualizado_en
      `,
      [
        nombre.toString().trim(),
        url.toString().trim(),
        secret_token ? secret_token.toString().trim() : null,
        !!activo,
        Number(timeout_ms) || 5000,
      ]
    );

    const webhook = insertRes.rows[0];

    for (const evento of EVENTOS_VALIDOS) {
      await client.query(
        `
        INSERT INTO webhook_evento (id_webhook, evento, activo)
        VALUES ($1, $2, $3)
        `,
        [webhook.id_webhook, evento, eventos.includes(evento)]
      );
    }

    await client.query("COMMIT");

    res.status(201).json({
      message: "Webhook creado correctamente",
      webhook,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Error createWebhook:", e);
    res.status(500).json({ message: "Error creando webhook" });
  } finally {
    client.release();
  }
};

exports.updateWebhook = async (req, res) => {
  const user = requireAdmin(req, res);
  if (!user) return;

  try {
    const { id } = req.params;
    const {
      nombre,
      url,
      secret_token = null,
      activo,
      timeout_ms = 5000,
    } = req.body;

    if (!nombre || !nombre.toString().trim()) {
      return res.status(400).json({ message: "El nombre es obligatorio" });
    }

    if (!url || !url.toString().trim()) {
      return res.status(400).json({ message: "La URL es obligatoria" });
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ message: "La URL no es válida" });
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return res.status(400).json({ message: "La URL debe iniciar con http o https" });
    }

    const result = await db.query(
      `
      UPDATE webhook_endpoint
      SET nombre = $1,
          url = $2,
          secret_token = $3,
          activo = $4,
          timeout_ms = $5,
          actualizado_en = now()
      WHERE id_webhook = $6
      RETURNING id_webhook, nombre, url, secret_token, activo, timeout_ms, creado_en, actualizado_en
      `,
      [
        nombre.toString().trim(),
        url.toString().trim(),
        secret_token ? secret_token.toString().trim() : null,
        typeof activo === "boolean" ? activo : true,
        Number(timeout_ms) || 5000,
        id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Webhook no encontrado" });
    }

    res.json({
      message: "Webhook actualizado correctamente",
      webhook: result.rows[0],
    });
  } catch (e) {
    console.error("Error updateWebhook:", e);
    res.status(500).json({ message: "Error actualizando webhook" });
  }
};

exports.updateWebhookEventos = async (req, res) => {
  const user = requireAdmin(req, res);
  if (!user) return;

  const client = await db.connect();

  try {
    const { id } = req.params;
    const { eventos = [] } = req.body;

    if (!Array.isArray(eventos)) {
      return res.status(400).json({ message: "Eventos inválidos" });
    }

    for (const ev of eventos) {
      if (!EVENTOS_VALIDOS.includes(ev)) {
        return res.status(400).json({ message: `Evento no permitido: ${ev}` });
      }
    }

    const existsRes = await client.query(
      `
      SELECT 1
      FROM webhook_endpoint
      WHERE id_webhook = $1
      `,
      [id]
    );

    if (existsRes.rows.length === 0) {
      return res.status(404).json({ message: "Webhook no encontrado" });
    }

    await client.query("BEGIN");

    for (const evento of EVENTOS_VALIDOS) {
      await client.query(
        `
        UPDATE webhook_evento
        SET activo = $1
        WHERE id_webhook = $2
          AND evento = $3
        `,
        [eventos.includes(evento), id, evento]
      );
    }

    await client.query(
      `
      UPDATE webhook_endpoint
      SET actualizado_en = now()
      WHERE id_webhook = $1
      `,
      [id]
    );

    await client.query("COMMIT");

    res.json({ message: "Eventos actualizados correctamente" });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Error updateWebhookEventos:", e);
    res.status(500).json({ message: "Error actualizando eventos" });
  } finally {
    client.release();
  }
};

exports.testWebhook = async (req, res) => {
  const user = requireAdmin(req, res);
  if (!user) return;

  try {
    const { id } = req.params;

    const webhookRes = await db.query(
      `
      SELECT
        id_webhook,
        nombre,
        url,
        secret_token,
        activo,
        timeout_ms
      FROM webhook_endpoint
      WHERE id_webhook = $1
      `,
      [id]
    );

    if (webhookRes.rows.length === 0) {
      return res.status(404).json({ message: "Webhook no encontrado" });
    }

    const webhook = webhookRes.rows[0];

    if (!webhook.activo) {
      return res.status(400).json({ message: "El webhook está inactivo" });
    }

    const payload = {
      evento: "TEST_WEBHOOK",
      timestamp: new Date().toISOString(),
      origen: "sistema_vuelos",
      data: {
        mensaje: "Prueba de conexión desde el panel de administración",
        webhook_id: webhook.id_webhook,
        nombre: webhook.nombre,
      },
    };

    const headers = {
      "Content-Type": "application/json",
    };

    if (webhook.secret_token) {
      headers["x-webhook-token"] = webhook.secret_token;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), webhook.timeout_ms || 5000);

    let response;
    try {
      response = await fetch(webhook.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();

    res.json({
      message: "Prueba ejecutada",
      ok: response.ok,
      status: response.status,
      response: text,
    });
  } catch (e) {
    console.error("Error testWebhook:", e);
    res.status(500).json({
      message: "Error probando webhook",
      error: e.message,
    });
  }
};