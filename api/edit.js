// api/edit.js — Lưu thay đổi caption và ảnh
import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { token, caption, selectedImages } = req.body;
  if (!token) return res.status(400).json({ error: "Thiếu token" });

  const project = await kv.get(`project:${token}`);
  if (!project) return res.status(404).json({ error: "Không tìm thấy bài" });

  await kv.set(`project:${token}`, {
    ...project,
    caption: caption || project.caption,
    selectedImages: selectedImages || project.selectedImages,
    editedAt: new Date().toISOString(),
  }, { ex: 60 * 60 * 24 * 7 });

  return res.status(200).json({ ok: true });
}
