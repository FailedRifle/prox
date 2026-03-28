const express = require("express");
const cors = require("cors");
const { createProxyMiddleware } = require("./proxy");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// Main proxy route
app.use("/go", createProxyMiddleware());

// Health check
app.get("/ping", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`GhostProxy running on port ${PORT}`);
});
