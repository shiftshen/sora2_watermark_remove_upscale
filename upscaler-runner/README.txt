upscaler-runner 使用说明

目标：在不影响去水印主服务的前提下，独立监听 Output 目录，自动将新视频交给 ComfyUI 按 videouper 工作流执行，并在成功后把成品复制到 outputupscaler；失败则保留源视频到 Faildupscaler。

一、目录结构
- index.js：监听与执行主程序
- package.json：项目声明与启动/停止脚本
- start.sh / stop.sh：一键启动和停止脚本
- config.json：可配置项（路径/工作流/批大小/超时等）
- workflows/videouper.json：工作流副本（仅供 runner 使用）

二、配置文件（config.json）
- OUTPUT_DIR：被监控的视频输入目录
- UPSCALER_OUTPUT_DIR：执行成功后复制的最终输出目录
- FAIL_UPSCALER_DIR：执行失败时保留源视频的目录
- COMFY_BASE_URL：ComfyUI 地址，如 http://192.168.1.200:28188
- COMFY_INPUT_DIR / COMFY_OUTPUT_DIR：容器映射的输入/输出目录
- WORKFLOW_PATH：工作流 JSON 路径（项目内副本）
- BATCH_SIZE / MIN_READY_SIZE / POLL_TIMEOUT_MS / POLL_INTERVAL_MS：执行参数
- DELETE_SOURCE_ON_SUCCESS：成功后是否删除源文件（true/false）

三、启动与停止
- 启动：
  RUNNER_CONFIG=/home/data/water_mark_remove/upscaler-runner/config.json ./start.sh
  或直接：./start.sh（默认使用本目录 config.json）
- 停止：
  ./stop.sh

四、运行逻辑
1) 监听 OUTPUT_DIR：忽略 ._ 前缀与过小/未写完文件；等写入稳定后开始处理
2) 复制到 COMFY_INPUT_DIR：提交 workflows/videouper.json（仅改入参：文件名、subfolder=input、batch_size）
3) 输出查找：在 COMFY_OUTPUT_DIR 按前缀 up_<源文件名无扩展> 找到 mp4；复制到 UPSCALER_OUTPUT_DIR/<源文件名>.mp4
4) 删除策略：DELETE_SOURCE_ON_SUCCESS=true 时，成功后删除源文件；否则保留
5) 失败：在 POLL_TIMEOUT_MS 内未找到输出则将源视频复制到 FAIL_UPSCALER_DIR

五、注意事项
- 建议仅运行一个实例，避免重复监听：可通过 stop.sh 停止后再启动
- 如需临时覆盖配置项，可用环境变量启动：
  OUTPUT_DIR=/path/to/Output UPSCALER_OUTPUT_DIR=/path/to/out ./start.sh
- 工作流的显存与编码设置已做兼容：输出采用 video/h264-mp4，避免 NVENC 缺失

