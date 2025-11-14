# upscaler-runner 使用说明

## 项目简介
- 独立监控 `OUTPUT_DIR` 新视频文件，调用 ComfyUI 的 videouper 工作流执行放大，成功后把成品复制到 `UPSCALER_OUTPUT_DIR`，失败则把源文件复制到 `FAIL_UPSCALER_DIR`。
- 与去水印主服务完全解耦；不修改、不删除主服务的任何文件。

## 目录结构
- `index.js`：监听与执行主程序
- `package.json`：项目声明与启动/停止脚本
- `start.sh` / `stop.sh`：一键启动与停止脚本
- `config.json`：可配置项（路径/工作流/批大小/超时/删除策略等）
- `workflows/videouper.json`：工作流副本（仅供本项目使用）

## 安装依赖
```bash
npm --prefix upscaler-runner install
```

## 启动与停止
- 启动（默认使用本目录 `config.json`）：
```bash
./upscaler-runner/start.sh
```
- 指定配置文件启动：
```bash
RUNNER_CONFIG=/path/to/config.json ./upscaler-runner/start.sh
```
- 停止：
```bash
./upscaler-runner/stop.sh
```

## 配置文件（config.json）
- `OUTPUT_DIR`：被监控的视频输入目录（默认 `/home/data/water_mark_remove/Output`）
- `UPSCALER_OUTPUT_DIR`：执行成功后复制的最终输出目录（默认 `/home/data/water_mark_remove/outputupscaler`）
- `FAIL_UPSCALER_DIR`：执行失败时保留源视频的目录（默认 `/home/data/water_mark_remove/Faildupscaler`）
- `COMFY_BASE_URL`：ComfyUI 地址（默认 `http://192.168.1.200:28188`）
- `COMFY_INPUT_DIR` / `COMFY_OUTPUT_DIR`：容器映射的输入/输出目录（例如 `/data/comfyui/input`、`/data/comfyui/output`）
- `WORKFLOW_PATH`：工作流 JSON 路径（默认 `upscaler-runner/workflows/videouper.json`）
- `BATCH_SIZE`：批大小（默认 `5`）
- `MIN_READY_SIZE`：文件就绪最小尺寸（避免半写入）（默认 `1048576` 字节）
- `POLL_TIMEOUT_MS`：等待输出超时（默认 `900000` 毫秒）
- `POLL_INTERVAL_MS`：轮询间隔（默认 `5000` 毫秒）
- `DELETE_SOURCE_ON_SUCCESS`：成功后是否删除源文件（默认 `true`）

> 配置优先级：环境变量 > `RUNNER_CONFIG` 指定的 `config.json` > 默认值。

## 运行流程
1. 监听 `OUTPUT_DIR`；过滤 `._` 前缀与小于 `MIN_READY_SIZE` 的未写完文件。
2. 复制源视频到 `COMFY_INPUT_DIR` 并提交 `WORKFLOW_PATH`（仅改入参：`video` 文件名、`subfolder=input`、`batch_size`）。
3. 在 `COMFY_OUTPUT_DIR` 按前缀 `up_<源文件无扩展名>` 找到 mp4；复制到 `UPSCALER_OUTPUT_DIR/<源文件名>.mp4`。
4. 成功：按 `DELETE_SOURCE_ON_SUCCESS` 决定是否删除源文件；失败：复制源视频到 `FAIL_UPSCALER_DIR`。

## 常见问题
- ffmpeg 报错 `Unknown encoder 'hevc_nvenc'`：已改用 `video/h264-mp4` 与 `yuv420p`，无需 NVENC；如需 NVENC，请在容器内安装支持 NVENC 的 ffmpeg。
- 显存 OOM：降低 `BATCH_SIZE`，或裁切更短片段先验证；必要时调整模型精度或启用 CPU/offload。
- 文件被外部删除：若 `Output` 根目录出现 `.smbdelete*`，通常为 SMB/同步工具清理；建议使用子目录或调整共享策略。

## 进程与实例
- 建议仅运行一个实例，避免重复监听。
- 检查实例：
```bash
ps -eo pid,cmd | grep -E 'node .*upscaler-runner/index.js' | grep -v grep
```

## 环境覆盖示例
```bash
OUTPUT_DIR=/path/to/Output UPSCALER_OUTPUT_DIR=/path/to/out ./upscaler-runner/start.sh
```

