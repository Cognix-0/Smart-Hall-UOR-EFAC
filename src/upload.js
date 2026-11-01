const multer = require('multer');

const EXTENSIONS = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };

// Disk upload into `folder`, accepting only the given MIME types, max 5 MB.
// A rejected file type leaves req.file undefined, which the route reports.
function makeUpload(folder, types) {
  return multer({
    storage: multer.diskStorage({
      destination: folder,
      filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${EXTENSIONS[file.mimetype]}`),
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, types.includes(file.mimetype)),
  });
}

module.exports = { makeUpload };
