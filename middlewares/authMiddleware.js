module.exports = function authMiddleware(req, res, next) {
  const userHeader = req.headers["x-user"];

  if (!userHeader) {
    return res.status(401).json({ message: "No autenticado" });
  }

  try {
    const user = JSON.parse(userHeader);

    if (!user.id_usuario || !user.rol) {
      return res.status(401).json({ message: "Sesión inválida" });
    }

    req.user = user;

    next();
  } catch (e) {
    return res.status(401).json({ message: "Token inválido" });
  }
};
