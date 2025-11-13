# 🎬 Sora 去水印自动化系统 - 使用教程

## 📋 目录

* [系统简介](#系统简介)

* [快速开始](#快速开始)

* [详细配置](#详细配置)

* [使用方法](#使用方法)

* [API接口](#api接口)

* [故障排除](#故障排除)

* [性能优化](#性能优化)

* [安全注意事项](#安全注意事项)

## 🎯 系统简介

Sora 去水印自动化系统是一个智能的视频文件监控和批处理平台，能够：

* **🔄 自动监控** Input文件夹中的视频文件变化

* **🎯 智能去水印** 调用Sora API进行专业视频去水印处理

* **📊 批处理管理** 支持并发处理和错误重试机制

* **📈 实时监控** 提供Web界面显示处理进度和状态

* **📝 完整日志** 记录所有处理过程和结果

### 适用场景

* 本地环境（服务端默认端口：25348）

* 生产服务器部署（如：http://192.168.1.200:25348）

## 🚀 快速开始

### 环境要求

* Node.js >= 16.0.0

* npm >= 8.0.0 或 pnpm >= 7.0.0

* 支持的视频格式：MP4, AVI, MOV, MKV等

### 一键启动（推荐）

```bash
# 进入项目目录
cd /Users/shift/Documents/trae/Auto_sora_water_mark_remove

# 一键启动完整流程
bash scripts/start-and-open.sh
```

脚本会自动：

* ✅ 清理端口（3000, 5173）

* ✅ 启动后端服务

* ✅ 等待服务就绪

* ✅ 打开浏览器访问监控面板

* ✅ 自动开始批处理

### 手动启动

```bash
# 1. 安装依赖
npm install

# 2. 启动服务
npm start

# 3. 在浏览器访问
# 本地：http://localhost:25348
# 或服务器：http://192.168.1.200:25348

# 4. 开始处理文件
curl -X POST http://localhost:25348/api/batch/start
```

### 服务器部署版本

对于已部署在服务器上的版本（如 http://192.168.1.200:25348）：

```bash
# SSH连接到服务器
ssh happy@192.168.1.200

# 进入项目目录
cd /home/data/water_mark_remove

# 查看服务状态
./node_modules/.bin/pm2 status

# 重启服务（如果需要）
SERVER_PORT=25348 NODE_ENV=production ./node_modules/.bin/pm2 restart beachcleaner --update-env

# 访问监控面板
# http://192.168.1.200:25348
```

## ⚙️ 详细配置

### 基础配置

创建或编辑 `.env` 文件：

```env
# === 基础目录配置 ===
INPUT_DIR=./Input          # 输入文件夹路径
OUTPUT_DIR=./Output        # 输出文件夹路径
LOGS_DIR=./logs           # 日志文件夹路径
DATA_DIR=./data           # 数据库文件夹路径

# === API配置 ===
SORA_API_BASE_URL=https://sora.xmanx.com  # Sora API基础URL
SORA_API_KEY=              # API密钥（如果需要）
API_TIMEOUT=300000         # API请求超时时间（毫秒）
API_RETRY_COUNT=3          # API重试次数
API_RETRY_DELAY=5000       # API重试延迟（毫秒）

# === 批处理配置 ===
BATCH_SIZE=5               # 每批处理的文件数量
MAX_CONCURRENT=3           # 最大并发处理数
RETRY_COUNT=3              # 处理失败重试次数
RETRY_DELAY=5000           # 重试延迟时间（毫秒）

# === 监控配置 ===
WATCH_DEBOUNCE_MS=2000     # 文件监控防抖时间（毫秒）
MAX_FILE_SIZE=524288000    # 最大文件大小（字节，默认500MB）
SERVER_PORT=25348          # 服务端口（默认 25348）
```

### 本地开发环境配置

```bash
# 1. 复制环境模板
cp .env.example .env

# 2. 编辑配置（保持默认即可）
nano .env

# 3. 确保目录存在
mkdir -p Input Output Failed logs data
```

### 服务器环境配置

```bash
# SSH连接后
ssh happy@192.168.1.200

# 编辑环境配置
cd /home/data/water_mark_remove
nano .env

# 服务器专用配置示例：
SERVER_PORT=25348
INPUT_DIR=/home/data/water_mark_remove/Input
OUTPUT_DIR=/home/data/water_mark_remove/Output
LOGS_DIR=/home/data/water_mark_remove/logs
DATA_DIR=/home/data/water_mark_remove/data
SORA_API_BASE_URL=https://sora.xmanx.com
```

## 📖 使用方法

### 1. 文件上传

**本地环境：**

```bash
# 方法一：直接复制文件
cp your-video.mp4 Input/

# 方法二：使用curl上传（如果有文件上传接口）
curl -F "file=@your-video.mp4" http://localhost:25348/api/upload
```

**服务器环境：**

```bash
# 从本地上传到服务器
scp your-video.mp4 happy@192.168.1.200:/home/data/water_mark_remove/Input/

# 或者使用rsync
rsync -avz your-video.mp4 happy@192.168.1.200:/home/data/water_mark_remove/Input/
```

### 2. 监控面板使用

访问监控面板：

* 本地：<http://localhost:25348>

* 服务器：<http://192.168.1.200:25348>

面板显示信息：

* 📊 **处理统计**：总文件数、已完成、处理中、失败数

* 📈 **实时进度**：当前处理进度百分比

* 🔗 **API状态**：Sora API连接状态

* 📁 **文件队列**：待处理文件列表

* ⚠️ **错误信息**：处理失败的原因

### 3. 批处理操作

```bash
# 开始批处理
curl -X POST http://localhost:25348/api/batch/start

# 停止批处理
curl -X POST http://localhost:25348/api/batch/stop

# 查看批处理状态
curl http://localhost:25348/api/batch/stats

# 清理已完成任务
curl -X DELETE http://localhost:25348/api/batch/completed

# 查看输入文件列表
curl http://localhost:25348/api/debug/input-files
```

### 4. 日志查看

```bash
# 实时查看日志
tail -f logs/server.log

# 查看错误日志
tail -f logs/error.log

# 查看处理日志
tail -f logs/processing.log

# 服务器环境
ssh happy@192.168.1.200 "tail -f /home/data/water_mark_remove/logs/server.log"
```

## 🔌 API接口

### 健康检查

```http
GET /api/health
```

响应：

```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "uptime": 3600
}
```

### 应用状态

```http
GET /api/status
```

响应：

```json
{
  "status": "running",
  "version": "1.0.0",
  "startTime": "2024-01-01T10:00:00.000Z",
  "processing": true,
  "queueSize": 5
}
```

### 文件列表

```http
GET /api/files
```

响应：

```json
[
  {
    "id": 1,
    "filename": "video1.mp4",
    "status": "completed",
    "progress": 100,
    "createdAt": "2024-01-01T10:00:00.000Z",
    "completedAt": "2024-01-01T10:05:00.000Z"
  }
]
```

### 统计信息

```http
GET /api/stats
```

响应：

```json
{
  "totalFiles": 10,
  "completed": 8,
  "processing": 1,
  "failed": 1,
  "queueSize": 2,
  "averageProcessingTime": 180,
  "successRate": 0.8
}
```

### 批处理控制

```http
POST /api/batch/start
POST /api/batch/stop
DELETE /api/batch/completed
GET /api/batch/stats
```

## 🔧 故障排除

### 常见问题及解决方案

#### 1. 服务无法启动

```bash
# 检查端口占用
netstat -tlnp | grep 25348

# 清理端口
npx kill-port 25348

# 重新启动
npm start
```

#### 2. 文件监控不工作

```bash
# 检查文件夹权限
ls -la Input/

# 确保文件夹存在
mkdir -p Input Output logs data

# 检查配置文件
 cat .env | grep INPUT_DIR
```

#### 3. API调用失败

```bash
# 测试API连通性
curl -I https://sora.xmanx.com/api/health

# 检查网络连接
ping sora.xmanx.com

# 查看错误日志
tail -n 50 logs/error.log
```

#### 4. 处理速度慢

* 检查系统资源：CPU、内存、磁盘IO

* 调整批处理配置：减小BATCH\_SIZE，降低MAX\_CONCURRENT

* 优化视频文件：压缩视频大小，统一格式

#### 5. 内存使用过高

```bash
# 监控内存使用
top -p $(pgrep -f "node.*index.js")

# 调整配置减小并发
# 编辑 .env 文件，降低 MAX_CONCURRENT 值
```

### 错误代码说明

| 错误代码 | 说明      | 解决方案                     |
| ---- | ------- | ------------------------ |
| 522  | API连接超时 | 检查网络，稍后重试                |
| 404  | 文件不存在   | 确认文件路径正确                 |
| 413  | 文件过大    | 减小文件大小或调整MAX\_FILE\_SIZE |
| 429  | API限流   | 降低处理并发数                  |
| 500  | 服务器错误   | 查看日志，重启服务                |

## ⚡ 性能优化

### 1. 批处理优化

```env
# 根据服务器性能调整
BATCH_SIZE=10          # 高性能服务器可适当增大
MAX_CONCURRENT=5       # 根据CPU核心数设置
RETRY_COUNT=2          # 减少重试次数提高速度
```

### 2. 文件处理优化

* 预处理视频：统一格式、适当压缩

* 批量上传：一次上传多个文件

* 错峰处理：避免高峰期集中处理

### 3. 系统优化

* 使用SSD存储提高IO性能

* 增加系统内存

* 使用CDN加速文件传输

* 定期清理日志和临时文件

### 4. 网络优化

```env
# 调整超时和重试
API_TIMEOUT=600000     # 大文件处理需要更长时间
API_RETRY_DELAY=10000  # 增加重试间隔
```

## 🔐 安全注意事项

### 1. 文件安全

* 验证上传文件类型，防止恶意文件

* 限制文件大小，避免DoS攻击

* 扫描病毒后再处理

### 2. API安全

* 使用HTTPS协议传输

* 配置API密钥（如需要）

* 实现请求限流

### 3. 系统安全

* 定期更新依赖包

* 使用非root用户运行服务

* 配置防火墙规则

* 定期备份重要数据

### 4. 访问控制

```bash
# 设置文件权限
chmod 755 Input Output Failed logs data

# 限制服务端口访问
# 在服务器防火墙中配置，只允许特定IP访问25348端口
```

### 5. 日志安全

* 不要在日志中记录敏感信息

* 定期清理旧日志

* 加密存储重要日志

## 📞 技术支持

如遇到问题，请按以下顺序排查：

1. 查看本教程的故障排除部分
2. 检查日志文件获取详细信息
3. 验证配置文件是否正确
4. 测试API连通性
5. 在GitHub提交Issue

**快速诊断命令：**

```bash
# 一键诊断脚本（可创建）
echo "=== 系统状态检查 ==="
curl -s http://localhost:25348/api/health | jq .
echo "=== 文件统计 ==="
curl -s http://localhost:25348/api/stats | jq .
echo "=== 最近错误 ==="
tail -n 10 logs/error.log
echo "=== 服务进程 ==="
ps aux | grep -E "(node|pm2)" | grep -v grep
```

***

**💡 提示：**

* 定期备份重要视频文件

* 监控磁盘空间使用情况

* 保持系统更新

* 关注Sora API服务状态

**🔗 相关链接：**

* [项目主页](https://github.com/shiftshen/sora2_watermark_remove_upscale)

* [Sora API文档](https://sora.xmanx.com/docs)

* [问题反馈](https://github.com/shiftshen/sora2_watermark_remove_upscale/issues)
