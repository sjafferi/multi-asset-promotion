const path = require("path");
const express = require("express");
const bodyParser = require("body-parser");
const fs = require('fs');
const app = require("./public/App.js");

const server = express();
server.use(bodyParser.json({ limit: "10mb" }));
server.use(express.static(path.join(__dirname, "public")));

server.get('/get-assets', function (req, res) {
  const path = `${__dirname}/data/assets.json`;
  const assets = fs.readFileSync(path);
  res.send(JSON.parse(assets));
});

server.get("*", function (req, res) {
  const { html } = app.render({ url: req.url });
  res.write(`
    <!DOCTYPE html>
    <link rel='stylesheet' href='/global.css'>
    <link rel='stylesheet' href='/bundle.css'>
    <link rel="stylesheet" href='/css/ag-grid.min.css'>
    <link rel="stylesheet" href='/css/ag-theme-balham.min.css'>
    <div id="app">${html}</div>
    <script src="/js/ag-grid-community.min.js"></script>
    <script src="/bundle.js"></script>
  `);

  res.end();
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Listening on port ${port}`));
