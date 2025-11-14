## 目标
- 将主站切换到可用的 Sora 模式（SORA_API_BASE_URL 指向 https://sora.xmanx.com/api 或你本机 25345）
- 移除本地回退“伪成功”，仅以真实接口结果判定成功/失败
- 严格禁止删除：成功/失败都不再 unlink，只允许转移（rename/copy）
- 失败自动移入 Failed；成功产出到 Output，并将源视频转移到成功归档目录
- 保持 upscaler-runner 独立运行，复制成品到 outputupscaler，不删除 Output 源文件

## 具体改动
1) 接口与健康检查
- 配置：新增/使用环境变量 `SORA_API_BASE_URL=https://sora.xmanx.com/api`（或 `http://192.168.1.200:25345/api`）
- `src/server/sora-api-client.js`
  - 移除我之前添加的 `local://` 回退分支（提交失败/查询失败不再返回 success）
  - 保留提交 `/api/submit_task`、轮询 `/api/get_results/<id>`、下载到本地的真实流程
  - 健康检查改为访问 `/api` 并显示状态（确认 200）

2) 主站执行与文件转移
- `src/server/index.js`
  - 在成功分支：取消 `safeDeleteInputFile`；改为转移源视频到归档目录（例如 `Archived/<相对路径>`），方法使用 `rename` 或 `copy+unlink`；失败分支保持 `moveFileToFailed`
  - 继续保留自动扫描与批处理启动；将 `MIN_READY_SIZE` 默认降为 1024（避免小文件不入队）
  - 开关：保留 `AUTO_MOVE_TO_FAILED`，默认 `true`

3) upscaler-runner 独立与禁止删除
- `upscaler-runner/config.json`：`DELETE_SOURCE_ON_SUCCESS=false`
- 保持“监控 Output→提交到 ComfyUI→复制到 outputupscaler”；不删除 Output 源文件

## 验证步骤
- 环境设置：`SORA_API_BASE_URL=https://sora.xmanx.com/api`（或 25345），`AUTO_MOVE_TO_FAILED=true`
- 重启主站（25348），查看首页健康卡片应显示 HTTP 200
- 将 3 个 mp4 放入 Input
- 触发批处理：`POST /api/batch/start`；查看 `GET /api/files?limit=50`
- 期望结果：
  - 成功：Output 生成 `<同名>_clean.mp4`；源文件从 Input 转移至 `Archived`；不做删除
  - 失败：源文件移动到 Failed，Input 保持干净
- 放大：upscaler-runner 自动提交 Output，新成品复制到 outputupscaler；不删除 Output 源文件

## 风险与回退
- 若 Sora 服务短时异常，任务会按真实失败标记并移入 Failed；不再“伪成功”。
- 若需要恢复旧行为（允许删除或本地回退），可通过环境开关或撤销改动。

## 交付
- 完成代码修复与配置更新
- 端到端测试 3 个 mp4，提供每个文件的处理状态与落地路径（Input→Archived/Failed、Output、outputupscaler）
