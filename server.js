require("dotenv").config();
const express = require("express");
const cors = require("cors");
const db = require("./config/db");


const authRoutes = require("./routes/authRoutes");
const alumnoRoutes = require("./routes/alumnoRoutes");
const agendarRoutes = require("./routes/agendarRoutes");
const programacionController = require("./routes/programacionRoutes");
const adminController = require("./routes/adminRoutes");
const usuarioController = require("./routes/usuarioRoutes");


const app = express();
const corsOptions = {
  origin: [
    "https://n8n-prueba-front.5hoafb.easypanel.host",
    "http://localhost:5173",
  ],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-user"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());
app.get("/api/health", async (req, res) => {
  try {
    const r = await db.query("SELECT NOW() as now");
    res.json({ ok: true, db_time: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});


db.query("SELECT NOW()")
  .then(res => console.log("🕒 Hora BD:", res.rows[0]))
  .catch(err => console.error("❌ Error BD:", err.message));

app.use("/api/auth", authRoutes);
app.use("/api/alumno", alumnoRoutes);
app.use("/api/agendar", agendarRoutes);
app.use("/api/programacion", programacionController);
app.use("/api/admin", adminController);
app.use("/api/usuario", usuarioController);

const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`)
);