import fs from 'fs/promises'
import path from 'path'
import chokidar from 'chokidar'
import axios from 'axios'

const CONFIG_PATH = process.env.RUNNER_CONFIG || path.join(process.cwd(), 'upscaler-runner', 'config.json')
let cfg = {
  OUTPUT_DIR: path.join(process.cwd(), 'Output'),
  UPSCALER_OUTPUT_DIR: path.join(process.cwd(), 'outputupscaler'),
  FAIL_UPSCALER_DIR: path.join(process.cwd(), 'Faildupscaler'),
  COMFY_BASE_URL: 'http://192.168.1.200:28188',
  COMFY_INPUT_DIR: '/data/comfyui/input',
  COMFY_OUTPUT_DIR: '/data/comfyui/output',
  WORKFLOW_PATH: path.join(process.cwd(), 'upscaler-runner', 'workflows', 'videouper.json'),
  BATCH_SIZE: 5,
  MIN_READY_SIZE: 1024 * 1024,
  POLL_TIMEOUT_MS: 15 * 60 * 1000,
  POLL_INTERVAL_MS: 5000,
  DELETE_SOURCE_ON_SUCCESS: true
}
try {
  const raw = await fs.readFile(CONFIG_PATH, 'utf-8')
  const json = JSON.parse(raw)
  cfg = { ...cfg, ...json }
} catch {}
const OUTPUT_DIR = process.env.OUTPUT_DIR || cfg.OUTPUT_DIR
const UPSCALER_OUTPUT_DIR = process.env.UPSCALER_OUTPUT_DIR || cfg.UPSCALER_OUTPUT_DIR
const FAIL_UPSCALER_DIR = process.env.FAIL_UPSCALER_DIR || cfg.FAIL_UPSCALER_DIR
const COMFY_BASE_URL = process.env.COMFY_BASE_URL || cfg.COMFY_BASE_URL
const COMFY_INPUT_DIR = process.env.COMFY_INPUT_DIR || cfg.COMFY_INPUT_DIR
const COMFY_OUTPUT_DIR = process.env.COMFY_OUTPUT_DIR || cfg.COMFY_OUTPUT_DIR
const WORKFLOW_PATH = process.env.WORKFLOW_PATH || cfg.WORKFLOW_PATH
const BATCH_SIZE = Number(process.env.BATCH_SIZE || cfg.BATCH_SIZE)
const MIN_READY_SIZE = Number(process.env.MIN_READY_SIZE || cfg.MIN_READY_SIZE)
const POLL_TIMEOUT_MS = Number(process.env.POLL_TIMEOUT_MS || cfg.POLL_TIMEOUT_MS)
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || cfg.POLL_INTERVAL_MS)
const DELETE_SOURCE_ON_SUCCESS = String(process.env.DELETE_SOURCE_ON_SUCCESS ?? String(cfg.DELETE_SOURCE_ON_SUCCESS)).toLowerCase() !== 'false'
const RUN_ONCE = String(process.env.RUN_ONCE ?? String(cfg.RUN_ONCE ?? 'false')).toLowerCase() === 'true'

let STOP_REQUESTED = false
let netController = new AbortController()
function requestStop() {
  STOP_REQUESTED = true
  try { netController.abort() } catch {}
  try { axios.post(`${COMFY_BASE_URL}/interrupt`, {}, { timeout: 1000 }).catch(() => {}) } catch {}
}
process.on('SIGTERM', requestStop)
process.on('SIGINT', requestStop)

async function ensureDirs() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  await fs.mkdir(UPSCALER_OUTPUT_DIR, { recursive: true })
  await fs.mkdir(FAIL_UPSCALER_DIR, { recursive: true })
}

function isSupported(p) {
  const b = path.basename(p)
  if (b.startsWith('._')) return false
  const ext = path.extname(p).toLowerCase()
  return ['.mp4', '.mov', '.mkv', '.webm'].includes(ext)
}

async function isReady(filePath) {
  try {
    const s1 = await fs.stat(filePath)
    if (s1.size < MIN_READY_SIZE) return false
    await new Promise(r => setTimeout(r, 1000))
    const s2 = await fs.stat(filePath)
    return s1.size === s2.size
  } catch {
    return false
  }
}

async function submitWorkflowFor(filePath) {
  const base = path.basename(filePath)
  const workflowRaw = await fs.readFile(WORKFLOW_PATH, 'utf-8')
  const wf = JSON.parse(workflowRaw)
  if (wf['2'] && wf['2'].inputs) {
    const containerPath = String(filePath).replace(/^\/data\/comfyui(\/|$)/, '/app/ComfyUI$1')
    wf['2'].inputs.video = containerPath
    wf['2'].inputs.load_audio = true
    try { delete wf['2'].inputs.upload_to_directory } catch {}
    try { delete wf['2'].inputs.subfolder } catch {}
  }
  if (wf['7'] && wf['7'].inputs) {
    wf['7'].inputs.batch_size = BATCH_SIZE
  }
  if (wf['9'] && wf['9'].inputs) {
    wf['9'].inputs.encode_tiled = true
    wf['9'].inputs.decode_tiled = true
    wf['9'].inputs.encode_tile_size = 512
    wf['9'].inputs.decode_tile_size = 512
    wf['9'].inputs.encode_tile_overlap = 64
    wf['9'].inputs.decode_tile_overlap = 64
  }
  if (wf['12'] && wf['12'].inputs) {
    wf['12'].inputs.format = 'video/h264-mp4'
    wf['12'].inputs.pix_fmt = 'yuv420p'
    wf['12'].inputs.save_output = true
    wf['12'].inputs.filename_prefix = `up_${path.parse(base).name}`
    wf['12'].inputs.audio = ['2', 2]
  }
  const prompt = { prompt: wf }
  try {
    netController = new AbortController()
    const resp = await axios.post(`${COMFY_BASE_URL}/prompt`, prompt, { headers: { 'Content-Type': 'application/json' }, timeout: 30000, signal: netController.signal })
    const pid = resp.data?.prompt_id || resp.data?.promptId || null
    console.log('submitted', base, 'pid', pid, 'status', resp.status)
    return pid
  } catch (e) {
    const err = e?.response?.data ? JSON.stringify(e.response.data) : String(e?.message || e)
    console.error('submit error for', base, err)
    return null
  }
}

async function pollHistory(promptId, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      if (STOP_REQUESTED) return { ok: false, error: 'stopped' }
      const r = await axios.get(`${COMFY_BASE_URL}/history/${promptId}`, { timeout: 10000, signal: netController.signal })
      const d = r.data
      if (d && typeof d === 'object') {
        const keys = Object.keys(d)
        if (keys.length > 0) {
          const item = d[keys[0]]
          if (item?.error) return { ok: false, error: item.error }
          const outputs = item?.outputs || {}
          const hasAny = Object.values(outputs).some(v => Array.isArray(v) ? v.length > 0 : !!v)
          if (hasAny) return { ok: true }
        }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 2000))
  }
  return { ok: false, error: 'history_timeout' }
}

async function copyToComfyInput(filePath) {
  const srcDir = path.dirname(filePath)
  if (path.resolve(srcDir) === path.resolve(COMFY_INPUT_DIR)) {
    return filePath
  }
  const dest = path.join(COMFY_INPUT_DIR, path.basename(filePath))
  await fs.mkdir(COMFY_INPUT_DIR, { recursive: true })
  await fs.copyFile(filePath, dest)
  return dest
}

async function waitForOutput(prefix, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      if (STOP_REQUESTED) return null
      const list = await fs.readdir(COMFY_OUTPUT_DIR)
      const cand = list.filter(n => n.startsWith(prefix) && n.endsWith('.mp4')).sort()
      if (cand.length > 0) return path.join(COMFY_OUTPUT_DIR, cand[0])
    } catch {}
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  }
  return null
}

async function processFile(filePath) {
  console.log('processing', filePath)
  const ready = await isReady(filePath)
  if (!ready) { console.log('skip not ready', filePath); return false }
  const comfyHostPath = await copyToComfyInput(filePath)
  const pid = await submitWorkflowFor(comfyHostPath)
  if (!pid) {
    const failDest = path.join(FAIL_UPSCALER_DIR, path.basename(filePath))
    try { await fs.copyFile(filePath, failDest) } catch {}
    console.error('failed to submit, copied to faild:', failDest)
    return false
  }
  const hist = await pollHistory(pid, POLL_TIMEOUT_MS)
  if (!hist.ok && hist.error === 'stopped') {
    console.error('stopped by user during processing:', path.basename(filePath))
    return false
  }
  if (!hist.ok && hist.error && hist.error !== 'history_timeout') {
    console.error('history error observed:', String(hist.error))
  }
  const outPrefix = `up_${path.parse(path.basename(filePath)).name}`
  const outFile = await waitForOutput(outPrefix, POLL_TIMEOUT_MS)
  if (outFile) {
    const dest = path.join(UPSCALER_OUTPUT_DIR, path.basename(filePath))
    const tmp = dest + '.tmp'
    await fs.copyFile(outFile, tmp)
    try { await fs.rename(tmp, dest) } catch { try { await fs.copyFile(tmp, dest) } catch {} }
    console.log('copied output to', dest)
    if (DELETE_SOURCE_ON_SUCCESS) {
      try { await fs.unlink(filePath) } catch {}
    }
    return true
  } else {
    const failDest = path.join(FAIL_UPSCALER_DIR, path.basename(filePath))
    try { await fs.copyFile(filePath, failDest) } catch {}
    console.error('timeout waiting output, copied to faild:', failDest)
    return false
  }
}

async function processWithRetry(filePath, times) {
  for (let i = 0; i < times; i++) {
    if (STOP_REQUESTED) return false
    const ok = await processFile(filePath)
    if (ok) return true
  }
  return false
}

async function start() {
  await ensureDirs()
  try {
    await axios.get(COMFY_BASE_URL, { timeout: 2000 })
  } catch {
    console.error('comfyui_unreachable', COMFY_BASE_URL)
    process.exit(2)
  }
  if (RUN_ONCE) {
    try {
      const files = await fs.readdir(OUTPUT_DIR)
      const vids = files.filter(n => !n.startsWith('._')).filter(n => ['.mp4','.mov','.mkv','.webm'].includes(path.extname(n).toLowerCase())).sort()
      if (vids.length === 0) {
        console.log('no videos found in input, exiting')
      }
      if (vids.length > 0) {
        console.log('plan total=', vids.length, 'files=', vids.join(','))
      }
      const queued = []
      for (const n of vids) {
        if (STOP_REQUESTED) break
        const p = path.join(OUTPUT_DIR, n)
        const ready = await isReady(p)
        if (!ready) { console.log('skip not ready', p); continue }
        const comfyPath = await copyToComfyInput(p)
        const pid = await submitWorkflowFor(comfyPath)
        if (pid) {
          console.log('queued', n, 'pid', pid)
          queued.push({ name: n, base: path.parse(n).name })
        } else {
          const failDest = path.join(FAIL_UPSCALER_DIR, n)
          try { await fs.copyFile(p, failDest) } catch {}
          console.error('queue_submit_failed copied to faild:', failDest)
        }
      }
      let ok = 0, fail = 0
      const tasks = queued.map(q => (async () => {
        if (STOP_REQUESTED) return false
        const outFile = await waitForOutput(`up_${q.base}`, POLL_TIMEOUT_MS)
        if (outFile) {
          const dest = path.join(UPSCALER_OUTPUT_DIR, q.name)
          const tmp = dest + '.tmp'
          await fs.copyFile(outFile, tmp)
          try { await fs.rename(tmp, dest) } catch { try { await fs.copyFile(tmp, dest) } catch {} }
          console.log('copied output to', dest)
          return true
        } else {
          const failDest = path.join(FAIL_UPSCALER_DIR, q.name)
          const src = path.join(OUTPUT_DIR, q.name)
          try { await fs.copyFile(src, failDest) } catch {}
          console.error('timeout waiting output, copied to faild:', failDest)
          return false
        }
      })())
      const results = await Promise.all(tasks)
      for (const r of results) { if (r) ok++; else fail++ }
      console.log('summary total=', vids.length, 'ok=', ok, 'fail=', fail)
    } finally {
      process.exit(0)
    }
    return
  }
  const watcher = chokidar.watch(OUTPUT_DIR, { ignoreInitial: false, depth: 4, awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 } })
  const queue = new Map()
  const handle = async p => {
    if (!isSupported(p)) return
    if (queue.get(p)) return
    queue.set(p, true)
    try { await processFile(p) } finally { queue.delete(p) }
  }
  watcher.on('add', handle)
  watcher.on('change', handle)
}

start()
// upscaler-runner
// 作用：独立监控 OUTPUT_DIR 下新视频，提交 videouper 工作流到 ComfyUI，
//      成功后将成品复制到 UPSCALER_OUTPUT_DIR，失败将源文件复制到 FAIL_UPSCALER_DIR。
// 配置优先级：环境变量 > RUNNER_CONFIG 指定的 config.json > 默认值
// 关键可配项：
//  - OUTPUT_DIR：被监控的输入目录
//  - UPSCALER_OUTPUT_DIR：最终成品输出目录（复制过去，不改名）
//  - FAIL_UPSCALER_DIR：失败保留目录（复制源文件）
//  - COMFY_BASE_URL：ComfyUI 服务地址
//  - COMFY_INPUT_DIR / COMFY_OUTPUT_DIR：容器映射的输入/输出目录
//  - WORKFLOW_PATH：工作流 JSON 路径（本项目内副本）
//  - BATCH_SIZE / MIN_READY_SIZE / POLL_TIMEOUT_MS / POLL_INTERVAL_MS / DELETE_SOURCE_ON_SUCCESS
