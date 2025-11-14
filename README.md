# 项目启动与使用教程

## 一键命令（根目录）
- 启动去水印服务：
```bash
./start-watermark.sh
```
- 停止去水印服务：
```bash
./stop-watermark.sh
```
- 启动放大自动化（独立项目）：
```bash
./upscaler-runner/start.sh
```
- 停止放大自动化：
```bash
./upscaler-runner/stop.sh
```

## 去水印服务说明
- 监听地址与端口：默认 `0.0.0.0:25348`
- 目录（默认，可通过环境变量覆盖）：
  - `INPUT_DIR`：`./Input`
  - `OUTPUT_DIR`：`./Output`
  - `FAILED_DIR`：`./Failed`
- 覆盖示例：
```bash
SERVER_HOST=0.0.0.0 SERVER_PORT=25348 INPUT_DIR=/data/in OUTPUT_DIR=/data/out ./start-watermark.sh
```
- 访问：`http://<服务器IP>:25348/`

## 放大自动化（upscaler-runner）
- 配置：`./upscaler-runner/config.json`（已含详细字段注释）
- 工作流：`./upscaler-runner/workflows/videouper.json`
- 行为：监听 `OUTPUT_DIR`，将新视频提交到 ComfyUI，成品复制到 `UPSCALER_OUTPUT_DIR`；失败复制源视频到 `FAIL_UPSCALER_DIR`；默认不删除源文件。
- 指定配置启动：
```bash
RUNNER_CONFIG=/path/to/config.json ./upscaler-runner/start.sh
```

## 常见问题
- 端口不可访问：确认 `ufw` 放行 `25348/tcp`，以及服务监听 `0.0.0.0`。
- ffmpeg NVENC 报错：已改为 `video/h264-mp4` 与 `yuv420p`，无需 NVENC。
- `Output` 文件被删除：大多源自 SMB/同步客户端。建议只读共享子目录或启用 `vfs recycle`，并在 Mac 端只读挂载。

