/**
 * 图片字节的**格式识别与尺寸解析**（自定义背景用）。
 *
 * ── 为什么不信任客户端给的 content-type 与扩展名 ────────────────────────
 *
 * 上传接口是**唯一的写入面**：往里塞什么，之后就会被当作图片服务出去
 * （`<img>` / `background-image`）。只信 `content-type` 等于让调用方自报家门 ——
 * 传个 `.png` 名字的 HTML 也会被存下来并以 `image/png` 发出去。
 *
 * 所以这里一律按**魔数**判定，扩展名反过来由识别结果决定。
 *
 * ── 为什么还要解析尺寸 ──────────────────────────────────────────────────
 *
 * 内置壁纸的「竖图用 contain」判据来自 `art/wallpapers.json`（生成器按宽高比算好）。
 * 自定义图没有清单条目，所以尺寸必须跟着设置一起存 —— 否则竖图会被 cover 裁成
 * 一条（只看到中间 40% 的高度，正是竖图那条既有修复要解决的问题）。
 *
 * 解析失败 → 返回 `null` → 上传被拒绝。宁可拒一张怪图，也不要存下一张
 * 「亮不出来、也不知道为什么」的图。
 *
 * 纯函数、零依赖：可以直接在测试里喂字节断言，不需要 DOM 或网络。
 */

/** 支持的格式 → 扩展名 + MIME。键是识别结果的内部名。 */
export const IMAGE_FORMATS = {
  png: { ext: 'png', mime: 'image/png' },
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  gif: { ext: 'gif', mime: 'image/gif' },
  webp: { ext: 'webp', mime: 'image/webp' }
}

/** 自定义背景的单文件上限（24 MB）。**与内置素材的上限分开**：内置素材是构建产物，可控。 */
export const CUSTOM_BG_MAX_BYTES = 24 * 1024 * 1024

/**
 * 从字节开头识别格式。
 *
 * @param {Buffer|Uint8Array} buf
 * @returns {'png'|'jpeg'|'gif'|'webp'|null}
 */
export function sniffFormat (buf) {
  if (buf === null || buf === undefined || buf.length < 12) return null
  const b = buf
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png'
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  // GIF: "GIF87a" / "GIF89a"
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 &&
      (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return 'gif'
  // WebP: "RIFF" … "WEBP"
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp'
  return null
}

/**
 * 解析尺寸。
 *
 * @param {Buffer|Uint8Array} buf 完整字节（或至少足够长的开头）
 * @param {string} format `sniffFormat` 的结果
 * @returns {{width:number, height:number}|null}
 */
export function readSize (buf, format) {
  try {
    if (format === 'png') return readPngSize(buf)
    if (format === 'gif') return readGifSize(buf)
    if (format === 'jpeg') return readJpegSize(buf)
    if (format === 'webp') return readWebpSize(buf)
  } catch {
    return null
  }
  return null
}

/** PNG：IHDR 紧跟 8 字节签名 + 4 字节长度 + "IHDR"，宽高各 4 字节大端。 */
function readPngSize (b) {
  if (b.length < 24) return null
  // 校验确实是 IHDR 块，而不是靠前 8 字节就下结论
  if (!(b[12] === 0x49 && b[13] === 0x48 && b[14] === 0x44 && b[15] === 0x52)) return null
  const width = b.readUInt32BE ? b.readUInt32BE(16) : readU32(b, 16)
  const height = b.readUInt32BE ? b.readUInt32BE(20) : readU32(b, 20)
  return sane(width, height)
}

/** GIF：宽高各 2 字节**小端**，位于 6 字节签名之后。 */
function readGifSize (b) {
  if (b.length < 10) return null
  const width = b[6] | (b[7] << 8)
  const height = b[8] | (b[9] << 8)
  return sane(width, height)
}

/**
 * JPEG：逐段扫描到 SOFn。
 *
 * 不能只读固定偏移 —— JPEG 在 SOFn 之前可能有任意多个段（EXIF/量化表等），
 * 整段长度写在段头里，所以要跳着走。跳过 APPn 时**不要把 `0xFF` 填充**算错。
 */
function readJpegSize (b) {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue }
    const marker = b[i + 1]
    // 填充字节（连续的 FF）→ 继续往后找
    if (marker === 0xff) { i += 1; continue }
    // 无参数的标记
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
    const len = (b[i + 2] << 8) | b[i + 3]
    if (len < 2) return null
    // SOF0..SOF15，但排除 DHT(c4) / JPG(c8) / DAC(cc)
    const isSof = marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      const height = (b[i + 5] << 8) | b[i + 6]
      const width = (b[i + 7] << 8) | b[i + 8]
      return sane(width, height)
    }
    i += 2 + len
  }
  return null
}

/**
 * WebP：三种子格式布局不同。
 *   VP8  （有损）：宽高在帧头，14 位
 *   VP8L （无损）：位打包的 14 位宽高
 *   VP8X （扩展）：24 位宽高（减一）
 */
function readWebpSize (b) {
  if (b.length < 30) return null
  const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15])
  if (fourcc === 'VP8 ') {
    // 3 字节帧标签 + 3 字节同步码(9D 01 2A) 之后是 16 位宽高（低 14 位有效）
    if (!(b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a)) return null
    const width = (b[26] | (b[27] << 8)) & 0x3fff
    const height = (b[28] | (b[29] << 8)) & 0x3fff
    return sane(width, height)
  }
  if (fourcc === 'VP8L') {
    if (b[20] !== 0x2f) return null
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
    const width = (bits & 0x3fff) + 1
    const height = ((bits >> 14) & 0x3fff) + 1
    return sane(width, height)
  }
  if (fourcc === 'VP8X') {
    const width = (b[24] | (b[25] << 8) | (b[26] << 16)) + 1
    const height = (b[27] | (b[28] << 8) | (b[29] << 16)) + 1
    return sane(width, height)
  }
  return null
}

/** 16 位大端读取（Buffer 以外的手写路径用）。 */
function readU32 (b, at) {
  return (b[at] * 0x1000000) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3]
}

/** 尺寸合理性：必须为正、且不超过一个荒唐的上限（防解析错位读出一个巨大数）。 */
function sane (width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null
  if (width <= 0 || height <= 0) return null
  if (width > 65535 || height > 65535) return null
  return { width, height }
}

/**
 * 竖图判据：宽高比小于阈值 → 用 `contain`（否则横屏下会被裁成一条）。
 *
 * ⚠️ **必须与 `tools/prepare-art.py` 的阈值一致**（那里是 0.87）。
 * 两处不一致会出现「内置竖图 contain、自定义竖图被裁」这种莫名其妙的不一致，
 * 所以测试里有一条断言盯着这两个数值相等。
 */
export const PORTRAIT_RATIO = 0.87

export function fitOfSize (size) {
  if (size === null || size === undefined) return 'cover'
  const { width, height } = size
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 'cover'
  return width / height < PORTRAIT_RATIO ? 'contain' : 'cover'
}
