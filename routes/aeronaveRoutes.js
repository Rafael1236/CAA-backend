const express = require("express");
const router = express.Router();
const { getAeronaves } = require("../controllers/aeronaveController");

router.get("/", getAeronaves);

module.exports = router;