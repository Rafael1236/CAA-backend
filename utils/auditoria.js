async function logAuditoria(client, {
  accion,
  entidad,
  id_entidad = null,
  id_semana = null,
  actor = null,
  req = null,
  descripcion = null,
  metadata = {},
  before_data = null,
  after_data = null,
  origen = "API",
}) {
  const actor_id_usuario = actor?.id_usuario ?? null;
  const actor_rol = (actor?.rol ?? "SYSTEM").toUpperCase();

  const ip = req?.ip ?? null;
  const user_agent = req?.headers?.["user-agent"] ?? null;

  await client.query(
    `
    INSERT INTO auditoria_evento
      (accion, entidad, id_entidad, id_semana, actor_id_usuario, actor_rol, ip, user_agent, origen,
       descripcion, metadata, before_data, after_data)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb)
    `,
    [
      accion,
      entidad,
      id_entidad,
      id_semana,
      actor_id_usuario,
      actor_rol,
      ip,
      user_agent,
      origen,
      descripcion,
      JSON.stringify(metadata ?? {}),
      before_data ? JSON.stringify(before_data) : null,
      after_data ? JSON.stringify(after_data) : null,
    ]
  );
}

module.exports = { logAuditoria };
