async function pushOutbox(client, {
  tipo,
  para_correo = null,
  para_id_usuario = null,
  payload = {}
}) {
  await client.query(
    `
    INSERT INTO notificacion_outbox (tipo, para_correo, para_id_usuario, payload)
    VALUES ($1,$2,$3,$4::jsonb)
    `,
    [tipo, para_correo, para_id_usuario, JSON.stringify(payload)]
  );
}

module.exports = { pushOutbox };
