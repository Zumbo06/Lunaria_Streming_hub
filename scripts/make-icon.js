// Renders build/icon.ico from the same crescent the launch screen draws.
//
// Run through Electron (`npm run icon`) rather than plain Node: Chromium is
// what rasterises the SVG, which avoids taking on an image dependency purely to
// produce one file. Re-run it whenever the mark changes.
//
// A modern .ico is a directory of images that may each be a whole PNG file, so
// the container is a 6-byte header plus a 16-byte entry per size and then the
// PNGs verbatim — no encoder needed beyond the one Chromium already has.

const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')

const SIZES = [16, 24, 32, 48, 64, 128, 256]
const OUT_DIR = path.join(__dirname, '..', 'build')
const OUT_FILE = path.join(OUT_DIR, 'icon.ico')

// The mark, sized to fill the canvas with a little breathing room. Kept in step
// with frontend/index.html by hand — it is nine lines of SVG, and sharing it
// would mean shipping a build step to read the HTML apart.
function markHtml(size) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;width:${size}px;height:${size}px;background:transparent}
  svg{display:block;width:${size}px;height:${size}px}
</style></head><body>
<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <mask id="c">
      <circle cx="60" cy="60" r="52" fill="#fff"/>
      <circle cx="89" cy="43" r="46" fill="#000"/>
    </mask>
    <linearGradient id="g" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="#3d4d8f"/>
      <stop offset="55%" stop-color="#6f8dff"/>
      <stop offset="100%" stop-color="#8ea4ff"/>
    </linearGradient>
  </defs>
  <circle cx="60" cy="60" r="52" fill="url(#g)" mask="url(#c)"/>
</svg>
</body></html>`
}

const MASTER = 256

/**
 * Rasterises the mark once at 256px. The smaller entries are downscaled from
 * that rather than re-rendered: seven windows is seven chances for an offscreen
 * paint to never arrive, and `nativeImage.resize` needs no compositor at all.
 */
async function renderMaster() {
  const win = new BrowserWindow({
    width: MASTER,
    height: MASTER,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
  })

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(markHtml(MASTER))}`)
  // `capturePage` on a window that has never been shown can resolve before the
  // first paint, so wait for one frame to be presented rather than a timer.
  await new Promise((resolve) => {
    if (win.webContents.isPainting?.()) return resolve()
    win.webContents.once('did-stop-loading', () => setTimeout(resolve, 250))
  })

  const shot = await win.webContents.capturePage()
  win.destroy()
  return shot
}

function pngAt(master, size) {
  // The ICO directory and the PNG header have to agree or Explorer rejects the
  // whole file, so the resize is explicit rather than trusting the capture.
  return master.resize({ width: size, height: size, quality: 'best' }).toPNG()
}

function buildIco(images) {
  const count = images.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // 1 = icon
  header.writeUInt16LE(count, 4)

  const directory = Buffer.alloc(16 * count)
  let offset = header.length + directory.length

  images.forEach(({ size, png }, index) => {
    const entry = index * 16
    // 256 is stored as 0 — the field is one byte and the format predates it.
    directory.writeUInt8(size >= 256 ? 0 : size, entry + 0)
    directory.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    directory.writeUInt8(0, entry + 2) // palette colours
    directory.writeUInt8(0, entry + 3) // reserved
    directory.writeUInt16LE(1, entry + 4) // colour planes
    directory.writeUInt16LE(32, entry + 6) // bits per pixel
    directory.writeUInt32LE(png.length, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })

  return Buffer.concat([header, directory, ...images.map((image) => image.png)])
}

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const master = await renderMaster()
  console.log(`  rasterised the mark at ${MASTER}x${MASTER}`)

  const images = SIZES.map((size) => {
    console.log(`  scaled ${size}x${size}`)
    return { size, png: pngAt(master, size) }
  })

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const ico = buildIco(images)
  fs.writeFileSync(OUT_FILE, ico)

  // The largest PNG doubles as the Linux/macOS source and is handy to eyeball.
  fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), images[images.length - 1].png)

  console.log(`\nwrote ${OUT_FILE} (${SIZES.length} sizes, ${(ico.length / 1024).toFixed(1)} KB)`)
  app.quit()
})
