require("dotenv").config();
const express = require("express");
const cors = require("cors");
const db = require("./config/db");


const authRoutes = require("./routes/authRoutes");
const alumnoRoutes = require("./routes/alumnoRoutes");

const app = express();
app.use(cors());
app.use(express.json());


db.query("SELECT NOW()")
  .then(res => console.log("🕒 Hora BD:", res.rows[0]))
  .catch(err => console.error("❌ Error BD:", err.message));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));

app.use("/api/auth", authRoutes);
app.use("/api/alumno", alumnoRoutes);
