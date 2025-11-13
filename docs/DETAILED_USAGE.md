# 🎬 Sora 去水印系统 - 详细使用文档

## 📋 目录
1. [系统概述](#系统概述)
2. [启动和关闭方法](#启动和关闭方法)
3. [文件和文件夹使用规范](#文件和文件夹使用规范)
4. [监控面板使用指南](#监控面板使用指南)
5. [服务状态检查](#服务状态检查)
6. [文件处理流程](#文件处理流程)
7. [常见问题处理](#常见问题处理)
8. [故障排除指南](#故障排除指南)
9. [性能优化建议](#性能优化建议)

---

## 🎯 系统概述

Sora 去水印系统是一个自动化的视频处理平台，能够：
- 自动监控指定文件夹中的视频文件
- 调用 Sora API 进行专业去水印处理
- 提供实时监控面板查看处理进度
- 支持批量处理和错误重试机制

---

## 🚀 启动和关闭方法

### 🏠 本地环境（默认端口：25348）

#### 一键启动（推荐）
```bash
# 进入项目目录
cd /Users/shift/Documents/trae/Auto_sora_water_mark_remove

# 一键启动脚本（自动打开浏览器）
bash scripts/start-and-open.sh

# 自定义端口启动
SERVER_PORT=25348 bash scripts/start-and-open.sh
```

#### 手动启动
```bash
# 安装依赖
npm install

# 开发模式（带热重载）
npm run dev

# 生产模式
npm start

# 使用PM2守护进程
npm run pm2:start
```

#### 关闭服务
```bash
# 停止PM2进程
npm run pm2:stop

# 或者直接杀死Node进程
pkill -f "node.*index.js"

# 清理端口
npx kill-port 25348 5173
```

### 🌐 远程服务器（示例：192.168.1.200:25348）

#### 连接服务器
```bash
# SSH连接（使用happy用户）
ssh happy@192.168.1.200

# 进入项目目录
cd /home/data/water_mark_remove
```

#### 远程启动
```bash
# 执行部署脚本（自动完成所有步骤）
bash scripts/deploy-remote.sh

# 手动启动服务（指定端口）
SERVER_PORT=25348 npm start
```

#### 远程关闭
```bash
# 查找并杀死进程
ps aux | grep node
kill -9 <PID>

# 或者使用pkill
pkill -f "node.*index.js"
```

#### 开机自启动检查
```bash
# 查看crontab配置
crontab -l | grep @reboot

# 预期输出：
# @reboot cd /home/data/water_mark_remove && SERVER_PORT=25348 npm start
```

---

## 📁 文件和文件夹使用规范

### 📂 目录结构
```
Auto_sora_water_mark_remove/
├── Input/           # 输入文件夹（放置待处理视频）
├── Output/          # 输出文件夹（处理成功视频，命名：name_clean.ext）
├── Failed/          # 失败文件夹（处理失败视频，保持子目录结构）
├── logs/            # 日志文件夹
├── data/            # 数据库文件
└── src/             # 源代码
```

### 📋 使用规则

#### Input 文件夹
- **用途**：放置需要去水印的视频文件
- **支持格式**：MP4, AVI, MOV, MKV 等常见视频格式
- **文件大小**：默认最大 500MB（可在配置中调整）
- **操作方式**：
  - 直接复制/移动视频文件到 `Input/` 目录
  - 支持子目录结构，保持原有目录层级
  - 系统会自动检测新文件并开始处理

#### Output 文件夹
- **用途**：存储处理成功的视频文件
- **目录结构**：保持与 Input 相同的子目录结构
- **文件命名**：在原始文件名基础上添加处理标识
- **访问方式**：处理完成后可直接下载或使用

#### Failed 文件夹
- **用途**：存储处理失败的视频文件
- **失败原因**：API错误、文件格式不支持、网络问题等
- **处理方式**：
  - 文件会保持原始名称和目录结构
  - 可重新放入 Input 文件夹重试
  - 系统会记录失败原因到日志

#### 符号链接（远程服务器）
```bash
# 服务器上创建了便捷的符号链接
input -> Input    # 输入目录快捷方式
output -> Output  # 输出目录快捷方式
```

### 🔄 文件处理流程
```
Input/文件 → 系统检测 → 加入队列 → 调用Sora API → 处理结果
                    ↓
               成功 → Output/目录
                    ↓
               失败 → Failed/目录 + 日志记录
```

---

## 📊 监控面板使用指南

### 🌐 访问地址
- **本地环境**：http://localhost:25348 或 http://localhost:5173
- **远程服务器**：http://192.168.1.200:25348

### 📱 面板功能

#### 1. 实时状态监控
- **系统状态**：显示服务运行状态
- **API连接**：显示Sora API连接状态
- **队列状态**：显示待处理文件数量
- **处理统计**：显示成功/失败文件数量

#### 2. 文件处理进度
- **当前处理**：显示正在处理的文件
- **进度条**：实时显示处理进度百分比
- **处理速度**：显示处理耗时和速度
- **错误信息**：显示失败原因（如果有）

#### 3. 批处理控制
- **开始处理**：手动触发批处理任务
- **停止处理**：暂停当前处理队列
- **清理完成项**：清理已完成的处理记录

#### 4. 自动刷新
- **刷新间隔**：每5秒自动刷新状态
- **手动刷新**：点击刷新按钮立即更新

---

## 🔍 服务状态检查

### 🏥 健康检查
```bash
# 本地健康检查
curl http://localhost:25348/api/health

# 远程服务器健康检查
curl http://192.168.1.200:25348/api/health

# 预期响应：{"status":"healthy","timestamp":"2024-..."}
```

### 📈 系统状态
```bash
# 获取完整状态信息
curl http://localhost:25348/api/status

# 获取处理统计
curl http://localhost:25348/api/stats

# 获取文件列表
curl http://localhost:25348/api/files
```

### 🔄 批处理控制
```bash
# 开始批处理
curl -X POST http://localhost:25348/api/batch/start

# 停止批处理
curl -X POST http://localhost:25348/api/batch/stop

# 清理完成项
curl -X DELETE http://localhost:25348/api/batch/completed
```

### 📋 调试接口
```bash
# 查看输入文件列表
curl http://localhost:25348/api/debug/input-files

# 查看批处理统计
curl http://localhost:25348/api/batch/stats
```

---

## 🔄 文件处理流程

### 📋 详细流程说明

1. **文件检测阶段**
   - 系统每5秒扫描 `Input/` 目录
   - 检测新添加或修改的视频文件
   - 验证文件格式和大小
   - 排除正在处理的文件

2. **队列管理阶段**
   - 将检测到的文件加入处理队列
   - 根据配置的最大并发数控制处理速度
   - 优先处理先发现的文件

3. **API处理阶段**
   - 上传视频文件到Sora API
   - 等待API处理完成（通常需要几分钟）
   - 定期检查处理进度
   - 下载处理完成的视频

4. **结果处理阶段**
   - **成功**：移动到 `Output/` 目录，保持原目录结构
   - **失败**：移动到 `Failed/` 目录，记录失败原因
   - **日志**：记录详细的处理过程和结果

5. **清理阶段**
   - 删除已处理的原始文件（避免重复处理）
   - 更新数据库记录
   - 释放系统资源

### ⏱️ 处理时间参考
- **小文件（<50MB）**：2-5分钟
- **中等文件（50-200MB）**：5-15分钟
- **大文件（>200MB）**：15-30分钟

*注：实际时间取决于Sora API的响应速度和网络状况*

---

## ❓ 常见问题处理

### 🔧 启动问题

#### 端口被占用
```bash
# 查看端口占用情况
lsof -i :3000
lsof -i :5173

# 清理端口
npx kill-port 3000 5173

# 或者使用其他端口
SERVER_PORT=4000 bash scripts/start-and-open.sh
```

#### 依赖安装失败
```bash
# 清理缓存
npm cache clean --force

# 重新安装
rm -rf node_modules package-lock.json
npm install
```

### 📁 文件处理问题

#### 文件不被检测
- **检查路径**：确认文件在 `Input/` 目录下
- **检查格式**：确认是支持的视频格式
- **检查大小**：确认文件未超过大小限制
- **检查权限**：确认有读取权限

#### 处理队列卡住
```bash
# 重启批处理
curl -X POST http://localhost:25348/api/batch/stop
curl -X POST http://localhost:25348/api/batch/start

# 清理队列
curl -X DELETE http://localhost:25348/api/batch/completed
```

#### 输出文件找不到
- **检查Output目录**：确认处理成功
- **检查子目录**：保持原目录结构
- **检查日志**：查看是否有错误信息

### 🌐 API连接问题

#### Sora API不可用
```bash
# 测试API连接
curl -sS -F "video=@/path/to/test.mp4" https://sora.xmanx.com/api/submit_task

# 检查网络连接
ping sora.xmanx.com

# 等待服务恢复或联系API提供商
```

#### API超时
- **增加超时时间**：修改 `.env` 文件中的 `API_TIMEOUT`
- **减少并发数**：降低 `MAX_CONCURRENT` 值
- **检查网络**：确认网络连接稳定

---

## 🔧 故障排除指南

### 🚨 紧急情况处理

#### 服务完全停止
1. **检查进程状态**
   ```bash
   ps aux | grep node
   ```

2. **重启服务**
   ```bash
   # 杀死所有Node进程
   pkill -f node
   
   # 重新启动
   npm start
   ```

3. **检查日志**
   ```bash
   # 查看错误日志
   tail -f logs/error.log
   
   # 查看应用日志
   tail -f logs/app.log
   ```

#### 文件处理异常
1. **清理失败文件**
   ```bash
   # 移动Failed文件回Input重试
   mv Failed/* Input/
   ```

2. **重置处理状态**
   ```bash
   # 清理数据库
curl -X DELETE http://localhost:25348/api/batch/completed
   ```

3. **手动触发处理**
   ```bash
   curl -X POST http://localhost:25348/api/batch/start
   ```

### 📞 联系支持

如果以上方法无法解决问题：

1. **收集信息**
   - 系统日志 (`logs/` 目录)
   - 错误截图
   - 操作步骤描述

2. **查看文档**
   - 检查本文档的最新版本
   - 查看GitHub Issues
   - 参考API文档

3. **提交问题**
   - 在GitHub提交Issue
   - 提供详细的错误信息
   - 包含环境配置信息

---

## ⚡ 性能优化建议

### 🚀 处理速度优化

1. **调整批处理参数**
   ```env
   BATCH_SIZE=10        # 增加批处理大小
   MAX_CONCURRENT=5     # 增加并发数
   ```

2. **优化文件大小**
   - 预处理大文件，分割成较小片段
   - 压缩视频文件（保持可接受的质量）
   - 选择合适的视频格式

3. **网络优化**
   - 使用稳定的网络连接
   - 考虑使用CDN加速
   - 避免高峰时段处理

### 💾 资源管理

1. **内存优化**
   - 定期清理日志文件
   - 限制并发处理数量
   - 监控内存使用情况

2. **磁盘空间**
   - 定期清理完成文件
   - 监控磁盘使用情况
   - 设置合理的文件大小限制

3. **数据库维护**
   - 定期清理旧记录
   - 优化数据库查询
   - 备份重要数据

---

## 📞 快速参考

### 🔗 常用命令速查
```bash
# 启动服务
npm start

# 检查状态
curl http://localhost:25348/api/health

# 开始处理
curl -X POST http://localhost:25348/api/batch/start

# 停止处理
curl -X POST http://localhost:25348/api/batch/stop

# 清理完成项
curl -X DELETE http://localhost:25348/api/batch/completed

# 查看日志
tail -f logs/app.log
```

### 📁 目录速查
- **Input/**：放置待处理视频
- **Output/**：查看处理结果
- **Failed/**：查看失败文件
- **logs/**：查看系统日志

### 🌐 访问地址
- **本地**：http://localhost:25348
- **远程**：https://github.com/shiftshen/sora2_watermark_remove_upscale

---

*最后更新：2024年*
*文档版本：v1.0*
