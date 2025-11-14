Upscaler Runner 使用说明

目录
- 输入目录：`/data/comfyui/input/upscaler`
- 输出目录：`/data/comfyui/output/upscaler`
- 配置文件：`upscaler-runner/config.json`
- 启动脚本：`upscaler-runner/start.sh`
- 停止脚本：`upscaler-runner/stop.sh`

一键批处理
- 单次批处理（处理完成自动退出）：
RUN_ONCE=true OUTPUT_DIR=/data/comfyui/input/upscaler ./start.sh
- 守护监听模式（持续监控新文件）：
OUTPUT_DIR=/data/comfyui/input/upscaler ./start.sh
- 停止：
./stop.sh

工作流与参数
- 加载：路径读取（容器路径 `/app/ComfyUI/input/upscaler/<文件>`）
- 升级：SeedVR2 `batch_size=1`，分辨率建议从 720 验证再提升
- 模型：`seedvr2_ema_3b_fp8_e4m3fn.safetensors`、`ema_vae_fp16.safetensors`
- 合成：`video/h264-mp4`、`pix_fmt=yuv420p`

常见问题
- 编码器缺失：如 `hevc_nvenc` 报错，使用 `video/h264-mp4`
- OOM：降低分辨率或开启 VAE 分片编码/解码