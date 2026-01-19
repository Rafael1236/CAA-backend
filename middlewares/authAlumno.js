module.exports = (req, res, next) => {
  const user = req.headers["x-user"];

  if (!user) {
    return res.status(401).json({ message: "No autenticado" });
  }

  const parsedUser = JSON.parse(user);

  if (parsedUser.rol !== "Alumno") {
    return res.status(403).json({ message: "Acceso denegado" });
  }

  req.user = parsedUser;
  next();
};
