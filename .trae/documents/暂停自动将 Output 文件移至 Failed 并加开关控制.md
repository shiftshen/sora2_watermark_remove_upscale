## 问题定位
- 触发源：当处理失败或启动异常时，系统会把 `Output` 中的 `.mp4` 移动到 `Failed`。
- 具体实现：
  - 服务端失败与超时移动：`src/server/index.js:641-669`（`moveFileToFailed`），在 `startRunner` 超时守卫与失败捕获处调用（`src/server/index.js:555-566`, `620-629`）。
  - 批处理重试耗尽后移动：`src/server/batch-processor.js:30-64`（`moveFileToFailed`）。
  - Autoupscaler 监控 `Output`/`output` 并在失败时移动：`autoupscaler/index.js:164-176`（`moveToFailed`），监控在 `autoupscaler/index.js:178-207`。
- 文件类型识别包含 `.mp4`：`src/server/index.js:438-450`、`autoupscaler/index.js:21-24`。

## 立即规避（不改代码）
- 暂停 `autoupscaler` 进程，避免对 `Output` 的自动移动。在您确认后，我将执行单条命令停止该进程（遵守“一次只执行一个命令”的规则）。若未使用 PM2，我将改为单条命令终止对应进程。

## 代码改动方案（加入安全开关与就绪检查）
### 开关：禁用失败自动移动
- 新增环境变量 `AUTO_MOVE_TO_FAILED`（默认 `true`）。当为 `false` 时：
  - 在 `src/server/index.js:641-669` 和 `src/server/batch-processor.js:30-64` 的 `moveFileToFailed` 前增加条件判断，直接记录日志并保留文件于原目录。
  - 在 `autoupscaler/index.js:164-176` 的 `moveToFailed` 前增加条件判断，失败时不移动，仅告警。

### 开关：禁用 Autoupscaler 监控
- 新增环境变量 `AUTOUPSCALER_ENABLED`（默认 `true`）。当为 `false` 时：
  - 跳过 `autoupscaler/index.js:178-207` 的 `chokidar.watch` 注册，避免对 `Output` 的任何处理。

### 启动就绪检查（避免“工作流未就绪”导致误移动）
- 在 `autoupscaler/index.js` 启动时检查工作流资产是否存在（如 `autoupscaler/workflows/...`，参见 `migrateWorkflowIfPresent` 逻辑 `autoupscaler/index.js:43-62`）。未就绪时：
  - 不启动监控；或自动将 `AUTOUPSCALER_ENABLED=false`。

### 目录拼写一致化
- 核对并统一使用 `Failed` 目录名（当前代码未使用 `Faild`）。如检测到 `Faild` 目录，提供迁移提示但不强制改动。

## 管理端点与配置
- 增加一个管理端点或配置项以动态切换两类开关：
  - `PUT /api/system/settings`：支持切换 `AUTO_MOVE_TO_FAILED` 与 `AUTOUPSCALER_ENABLED`。
  - 变更后在运行时立即生效（读取环境或内存配置管理）。

## 验证与回归
- 编写用例：
  - 失败场景下，当 `AUTO_MOVE_TO_FAILED=false` 时，`.mp4` 保持在 `Output`。
  - 当 `AUTOUPSCALER_ENABLED=false` 时，`Output` 放入新 `.mp4` 不再被移动或删除。
- 手动验证：将测试 `.mp4` 放入 `Output`，模拟失败，观察行为。

## 回滚与安全
- 不改动现有默认行为（默认仍会移动到 `Failed`），仅在开关关闭时改变行为。
- 对跨分区 `rename` 回退逻辑保持不变，避免引入文件丢失风险。

## 后续操作
- 您确认后：
  1) 先执行单条命令暂时停止 `autoupscaler`（立即生效）。
  2) 实施代码改动与配置（加入两个开关与就绪检查）。
  3) 单条命令重启相关服务并逐步验证。