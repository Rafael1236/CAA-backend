const supabase = require("../config/supabase");

// Obtener todos los alumnos
exports.getAlumnos = async (req, res) => {
  const { data, error } = await supabase.from("alumnos").select("*");

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json(data);
};