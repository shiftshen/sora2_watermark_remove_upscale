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

async function ensureDirs() {
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
    wf['2'].inputs.video = base
    wf['2'].inputs.subfolder = 'input'
  }
  if (wf['7'] && wf['7'].inputs) {
    wf['7'].inputs.batch_size = BATCH_SIZE
  }
  if (wf['12'] && wf['12'].inputs) {
    wf['12'].inputs.format = 'video/h264-mp4'
    wf['12'].inputs.pix_fmt = 'yuv420p'
    wf['12'].inputs.save_output = true
    wf['12'].inputs.filename_prefix = `up_${path.parse(base).name}`
  }
  const prompt = { prompt: wf }
  const resp = await axios.post(`${COMFY_BASE_URL}/prompt`, prompt, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 })
  return resp.data?.prompt_id || resp.data?.promptId || null
}

async function copyToComfyInput(filePath) {
  const dest = path.join(COMFY_INPUT_DIR, path.basename(filePath))
  await fs.mkdir(COMFY_INPUT_DIR, { recursive: true })
  await fs.copyFile(filePath, dest)
  return dest
}

async function waitForOutput(prefix, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const list = await fs.readdir(COMFY_OUTPUT_DIR)
      const cand = list.filter(n => n.startsWith(prefix) && n.endsWith('.mp4')).sort()
      if (cand.length > 0) return path.join(COMFY_OUTPUT_DIR, cand[0])
    } catch {}
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  }
  return null
}

async function processFile(filePath) {
  const ready = await isReady(filePath)
  if (!ready) return
  await copyToComfyInput(filePath)
  const pid = await submitWorkflowFor(filePath)
  const outPrefix = `up_${path.parse(path.basename(filePath)).name}`
  const outFile = await waitForOutput(outPrefix, POLL_TIMEOUT_MS)
  if (outFile) {
    const dest = path.join(UPSCALER_OUTPUT_DIR, path.basename(filePath))
    await fs.copyFile(outFile, dest)
    if (DELETE_SOURCE_ON_SUCCESS) {
      try { await fs.unlink(filePath) } catch {}
    }
  } else {
    const failDest = path.join(FAIL_UPSCALER_DIR, path.basename(filePath))
    try { await fs.copyFile(filePath, failDest) } catch {}
  }
}

async function start() {
  await ensureDirs()
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
