const multer = require("multer");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { OrderError } = require("../services/orderService");

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const imageDirectory = path.join(__dirname, "..", "public", "images");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 16, parts: 18, fieldSize: 20 * 1024 }
}).single("productImage");

function parseProductImage(req, res, next) {
  upload(req, res, error => {
    if (error) {
      const message = error.code === "LIMIT_FILE_SIZE"
        ? "商品图片不能超过 5 MB。"
        : "图片上传未完成，请选择一张 JPG、PNG 或 WebP 图片后重试。";
      req.imageUploadError = new OrderError(message, 422);
    }
    next();
  });
}

// Determine the extension from the file contents, never from its original name.
function imageExtension(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && buffer.toString("ascii", 12, 16) === "IHDR") return "png";
  if (buffer.length >= 4 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 && buffer[buffer.length-2] === 255 && buffer[buffer.length-1] === 217) return "jpg";
  if (buffer.length >= 20 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(buffer.toString("ascii", 12, 16)) && buffer.readUInt32LE(4) === buffer.length - 8) return "webp";
  throw new OrderError("请选择有效的 JPG、PNG 或 WebP 商品图片。", 422);
}

async function saveProductImage(file) {
  if (!file?.buffer?.length) throw new OrderError("请选择商品图片。", 422);
  if (file.buffer.length > MAX_IMAGE_BYTES) throw new OrderError("商品图片不能超过 5 MB。", 422);
  const filename = `product-upload-${randomUUID()}.${imageExtension(file.buffer)}`;
  try {
    await fs.writeFile(path.join(imageDirectory, filename), file.buffer, { flag: "wx" });
  } catch (error) {
    if (["EACCES", "EPERM", "EROFS"].includes(error.code)) throw new OrderError("图片保存失败，请检查服务对商品图片目录的写入权限。", 422);
    throw error;
  }
  return `/images/${filename}`;
}

async function discardProductImage(imagePath) {
  if (!/^\/images\/product-upload-[a-f0-9-]{36}\.(jpg|png|webp)$/.test(imagePath)) throw new Error("Invalid upload cleanup path");
  await fs.unlink(path.join(imageDirectory, path.basename(imagePath))).catch(error => {
    if (error.code !== "ENOENT") throw error;
  });
}

module.exports = { parseProductImage, saveProductImage, discardProductImage };
