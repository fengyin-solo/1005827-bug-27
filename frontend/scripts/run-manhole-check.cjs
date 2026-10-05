// 责任规则端到端验证：esbuild 临时打包后在 Node 里跑（localStorage 打桩）。
const { build } = require('/workspace/frontend/node_modules/esbuild')
const path = require('path')

const storage = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
}

;(async () => {
  const result = await build({
    entryPoints: [path.join(__dirname, 'manhole-check-entry.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    alias: { '@': path.join(__dirname, '..', 'src') },
  })
  const code = result.outputFiles[0].text
  const module = { exports: {} }
  new Function('module', 'exports', 'require', code)(module, module.exports, require)
  const checks = module.exports.default()
  let failed = 0
  for (const check of checks) {
    console.log(`${check.pass ? 'PASS' : 'FAIL'}  ${check.name}`)
    if (!check.pass) {
      failed += 1
      console.log(`        ${check.detail}`)
    }
  }
  process.exit(failed ? 1 : 0)
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
