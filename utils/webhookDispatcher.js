const db = require("../config/db");

async function dispatchWebhook(evento, payload = {}) {
  try {
    const result = await db.query(
      `
      SELECT
        we.id_webhook,
        we.nombre,
        we.url,
        we.secret_token,
        we.timeout_ms
      FROM webhook_endpoint we
      JOIN webhook_evento ev
        ON ev.id_webhook = we.id_webhook
      WHERE we.activo = true
        AND ev.activo = true
        AND ev.evento = $1
      ORDER BY we.id_webhook
      `,
      [evento]
    );

    if (result.rows.length === 0) {
      return;
    }

    for (const webhook of result.rows) {
      const body = {
        evento,
        timestamp: new Date().toISOString(),
        origen: "sistema_vuelos",
        data: payload,
      };

      const headers = {
        "Content-Type": "application/json",
      };

      if (webhook.secret_token) {
        headers["x-webhook-token"] = webhook.secret_token;
      }

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        webhook.timeout_ms || 5000
      );

      try {
        const response = await fetch(webhook.url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const txt = await response.text();
          console.error(
            `Webhook ${webhook.nombre} respondió ${response.status}: ${txt}`
          );
        }
      } catch (err) {
        console.error(
          `Error enviando webhook ${webhook.nombre}:`,
          err.message
        );
      } finally {
        clearTimeout(timeout);
      }
    }
  } catch (e) {
    console.error("Error general dispatchWebhook:", e);
  }
}

module.exports = { dispatchWebhook };