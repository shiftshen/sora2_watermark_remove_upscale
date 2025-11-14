import express from 'express'
import path from 'path'
import fs from 'fs/promises'
import cors from 'cors'

const app = express()
app.use(express.json())
app.use(cors({ origin: '*' }))

const ROOT = process.cwd()
const PID_FILE = path.join(ROOT, 'upscaler-runner.pid')
const LOG_FILE = path.join(ROOT, 'upscaler-runner.out')
const CONFIG_PATH = path.join(ROOT, 'config.json')

app.get('/api/ups/status', async (req, res) => {
  let running = false
  try {
    const pid = await fs.readFile(PID_FILE, 'utf-8').catch(() => '')
    if (pid) {
      try { process.kill(Number(pid), 0); running = true } catch {}
    }
  } catch {}
  const cfgRaw = await fs.readFile(CONFIG_PATH, 'utf-8').catch(() => '{}')
  res.json({ success: true, data: { running, pidFile: PID_FILE, logFile: LOG_FILE, config: JSON.parse(cfgRaw) } })
})

app.post('/api/ups/start', async (req, res) => {
  const { config, deleteSourceOnSuccess } = req.body || {}
  const env = { RUNNER_CONFIG: CONFIG_PATH }
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8').catch(() => '{}')
    const current = JSON.parse(raw || '{}')
    const next = { ...current }
    if (typeof deleteSourceOnSuccess === 'boolean') {
      next.DELETE_SOURCE_ON_SUCCESS = deleteSourceOnSuccess
    }
    if (config && typeof config === 'object') {
      Object.assign(next, config)
    }
    await fs.writeFile(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf-8')
  } catch {}
  const child = require('child_process').spawn('bash', ['-lc', `"${path.join(ROOT, 'start.sh')}"`], { env, stdio: 'ignore', detached: true })
  child.unref()
  res.json({ success: true })
})

app.post('/api/ups/stop', async (req, res) => {
  const child = require('child_process').spawn('bash', ['-lc', `"${path.join(ROOT, 'stop.sh')}"`], { stdio: 'ignore', detached: true })
  child.unref()
  res.json({ success: true })
})

// 完整页面
app.get('/', async (req, res) => {
  const htmlPath = path.join(ROOT, 'web.html')
  try {
    const html = await fs.readFile(htmlPath, 'utf-8')
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(html)
  } catch {
    res.status(404).json({ success: false, error: '接口不存在' })
  }
})

const port = Number(process.env.UPS_CONTROL_PORT || 25349)
app.listen(port, '0.0.0.0', () => {
  console.log(`Upscaler Control listening on http://0.0.0.0:${port}`)
})

// 批量处理现有 Output 文件
function extSupported(name){const e=name.toLowerCase().slice(name.lastIndexOf('.'));return ['.mp4','.mov','.mkv','.webm'].includes(e)}
async function submitPrompt(baseURL, workflowPath, videoName){
  const raw=await fs.readFile(workflowPath,'utf-8');const wf=JSON.parse(raw);if(wf['2']&&wf['2'].inputs){wf['2'].inputs.video=videoName;wf['2'].inputs.subfolder='input'}if(wf['7']&&wf['7'].inputs){wf['7'].inputs.batch_size=wf['7'].inputs.batch_size||5}if(wf['12']&&wf['12'].inputs){wf['12'].inputs.format='video/h264-mp4';wf['12'].inputs.pix_fmt='yuv420p';wf['12'].inputs.save_output=true}const prompt={prompt:wf};const r=await fetch(`${baseURL}/prompt`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(prompt)});return r.ok}
app.post('/api/ups/process-existing', async (req,res)=>{
  try{
    const cfgRaw=await fs.readFile(CONFIG_PATH,'utf-8').catch(()=> '{}');const cfg=JSON.parse(cfgRaw||'{}')
    const outDir=cfg.OUTPUT_DIR;const comfyIn=cfg.COMFY_INPUT_DIR;const comfyOut=cfg.COMFY_OUTPUT_DIR;const baseURL=cfg.COMFY_BASE_URL;const wfPath=cfg.WORKFLOW_PATH
    const files=await fs.readdir(outDir)
    const vids=files.filter(n=>!n.startsWith('._') && extSupported(n))
    let count=0
    for(const n of vids){
      const src=path.join(outDir,n);const dest=path.join(comfyIn,n)
      await fs.copyFile(src,dest).catch(()=>{})
      const ok=await submitPrompt(baseURL,wfPath,n)
      if(ok) count++
    }
    res.json({success:true,data:{submitted:count,total:vids.length}})
  }catch(e){res.json({success:false,error:String(e)})}
})

// 最近输出与日志
app.get('/api/ups/outputs', async (req,res)=>{
  try{
    const cfgRaw=await fs.readFile(CONFIG_PATH,'utf-8').catch(()=> '{}');const cfg=JSON.parse(cfgRaw||'{}')
    const dir=cfg.COMFY_OUTPUT_DIR
    const list=await fs.readdir(dir)
    const items=await Promise.all(list.filter(n=>n.endsWith('.mp4')).map(async n=>{const st=await fs.stat(path.join(dir,n)).catch(()=>null);return st?{name:n,size:st.size,mtime:st.mtimeMs}:null}))
    const filtered=items.filter(Boolean).sort((a,b)=>b.mtime-a.mtime).slice(0,20)
    res.json({success:true,data:filtered})
  }catch(e){res.json({success:false,error:String(e)})}
})
app.get('/api/ups/logs', async (req,res)=>{
  try{const txt=await fs.readFile(LOG_FILE,'utf-8');const tail=txt.split('\n').slice(-200).join('\n');res.json({success:true,data:{tail}})}catch(e){res.json({success:false,error:String(e)})}
})

app.get('/api/ups/summary', async (req,res)=>{
  try{
    const cfgRaw=await fs.readFile(CONFIG_PATH,'utf-8').catch(()=> '{}');const cfg=JSON.parse(cfgRaw||'{}')
    const outDir=cfg.OUTPUT_DIR;const comfyIn=cfg.COMFY_INPUT_DIR;const comfyOut=cfg.COMFY_OUTPUT_DIR;const upOut=cfg.UPSCALER_OUTPUT_DIR
    const vids=(await fs.readdir(outDir).catch(()=>[])).filter(n=>!n.startsWith('._')).filter(n=>extSupported(n))
    const inQ=(await fs.readdir(comfyIn).catch(()=>[])).filter(n=>extSupported(n))
    const outOk=(await fs.readdir(comfyOut).catch(()=>[])).filter(n=>n.endsWith('.mp4'))
    const copied=(await fs.readdir(upOut).catch(()=>[])).filter(n=>extSupported(n))
    const setIn=new Set(inQ);const setOut=new Set(outOk.map(n=>n.replace(/-audio\.mp4$/,'')));const setCopied=new Set(copied)
    const pending=[];const processing=[];const completed=[]
    for(const n of vids){
      if(setCopied.has(n)){completed.push(n);continue}
      if(setIn.has(n)){processing.push(n);continue}
      pending.push(n)
    }
    res.json({success:true,data:{counts:{output:vids.length,pending:pending.length,processing:processing.length,completed:completed.length},lists:{pending,processing,completed}}})
  }catch(e){res.json({success:false,error:String(e)})}
})
