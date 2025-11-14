# 🧰 WORKLOG - 部署与验收记录

日期：2025-11-08
环境：远端服务器（happy@192.168.1.200）
目录：/home/data/watermark/beachcleaner
端口：25347

## 操作与结果
- 远端目录准备：创建 Input/Output/data/logs 结构（成功）。
- 项目同步：rsync 上传至 `/home/data/watermark/beachcleaner`（成功）。
- 依赖安装：`npm ci`（成功，3 个中等漏洞待后续审计）。
- 环境变量：写入 `.env`（PORT=25347、目录映射、Sora API 重试与超时）（成功）。
- 端口卫生：清理 25347（无进程占用，成功）。
- 进程管理：使用本地 pm2（项目内）启动 `beachcleaner`（成功，已 pm2 save）。
- 健康检查：`GET http://localhost:25347/api/health` 返回 healthy（API baseURL 可达，latency≈168ms）。
- 远端 E2E：初次失败（缺少无沙箱 Chrome 参数）；脚本增强后仍在服务器侧崩溃。
- 本地→远端验收：通过（首屏 55ms，`BASE_URL=http://192.168.1.200:25347`，无错误）。

## 日志与证据
- pm2 状态：`beachcleaner` online，监听 `*:25347`。
- 端口检查：`ss -ltnp | grep 25347` 显示 Node 进程监听。
- 健康检查响应：`status=healthy`、`reachable=true`、`status=200`、`latencyMs≈168`。
- 本地 E2E 输出：`E2E OK`，`Page DOM loaded in 55ms`。
- 服务器端 Puppeteer 崩溃栈：chromium 在无沙箱环境仍 crash（Linux 内核/容器环境限制可能）。

## 错误处理与恢复验证
- Sora API：此前 522 超时问题在本次健康检查未复现；仍保留 `retryCount=3 / retryDelay=5000` 策略。
- 远端 E2E：因 Puppeteer 在目标服务器环境崩溃，改用“外部验收（本地对远端URL）”满足 2 秒标准；CI 侧建议改用 Playwright + WebKit/Firefox 作为备选。

## 结论与后续
- 服务已在远端 `25347` 端口稳定运行，健康检查OK，UI可在LAN访问。
- E2E验收：本地对远端URL通过（≤2秒无错）。
- 建议：
  1) 若需在服务器内跑 E2E，安装 `chromium` 系统依赖或启用 `--remote-debugging-port` 配合 headless client。
  2) CI 改为 Playwright headless-firefox 备选，避免 Chrome 沙箱限制。
  3) 运行 `npm audit` 并评估升级 `multer` 至 2.x 以消除已知漏洞警告。

## 环境与安全
- `.env` 无敏感密钥入库；端口与目录可配置化；受控日志输出。
- 端口卫生流程执行：`kill-port/fuser` 检查无占用。
- 进程持久化：pm2 本地依赖方案，避免全局安装权限问题。

## 状态
- STATUS.md：保持 `in-test`，新增“远端部署与验收完成（UI/健康/端口）”注记；上游 API 端到端仍需观察。
- 部署验证完成：已生成证据，待你确认后再上传 Git。