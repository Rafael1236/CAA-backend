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
  const { data, error } = await supabase.from("alumnos").select("*");

  if (error) {
    console.error("❌ Error conectando a Supabase:", error.message);
    process.exit(1);
  } else {
    console.log("✅ Conectado a Supabase exitosamente.");
  }
})();
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));



app.use("/api/alumnos", alumnosRoutes);
app.use("/api/aeronaves", aeronaveRoutes);