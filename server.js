require("dotenv").config();
const express = require("express");
const cors = require("cors");
const supabase = require("./config/supabase");

const alumnosRoutes = require("./routes/alumnosRoutes");
const aeronaveRoutes = require("./routes/aeronaveRoutes");


const app = express();
app.use(cors());
app.use(express.json());


(async () => {
  try {
    const { error } = await supabase.from("alumnos").select("*").limit(1);

    if (error) {
      console.error("⚠️ Supabase conectado, pero hubo un error:", error.message);
    } else {
      console.log("✅ Conectado a Supabase exitosamente.");
    }
  } catch (err) {
    console.error("⚠️ No se pudo verificar Supabase:", err.message);
  }
})();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));



app.use("/api/alumnos", alumnosRoutes);
app.use("/api/aeronaves", aeronaveRoutes);