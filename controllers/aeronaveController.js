const supabase = require("../config/supabase");

// obtener todas las aeronaves
exports.getAeronaves = async (req, res) => {
  const { data, error } = await supabase.from("aeronaves").select("*");

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json(data);
};