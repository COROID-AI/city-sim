/*
 * server.js — Zero-dependency static file server for the Snake game.
 * CommonJS (require) so `node --check server.js` passes.
 * Binds to 127.0.0.1 and reads the port from process.env.PORT.
 */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');

var HOST = '127.0.0.1';
var PORT = process.env.PORT || 3000;
var ROOT = __dirname;

var MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

var server = http.createServer(function (req, res) {
  var urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://' + req.headers.host).pathname);
  } catch (err) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  if (urlPath === '/') urlPath = '/index.html';

  var filePath = path.normalize(path.join(ROOT, urlPath));

  // Prevent path traversal outside the served directory.
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, function (err, stats) {
    if (err || !stats.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    var ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, function () {
  console.log('Snake game server running at http://' + HOST + ':' + PORT);
});