// files.js — stub route for file upload/download operations.
// TODO: implement endpoints for:
//   POST /api/files/upload  — accept video/model file uploads (multipart)
//   GET  /api/files/:id     — retrieve a previously uploaded file
//   DELETE /api/files/:id   — remove an uploaded file

import { Router } from 'express';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', route: 'files' });
});

export default router;
