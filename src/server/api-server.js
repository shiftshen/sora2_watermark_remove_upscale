const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { logger } = require('./logger');
const { ConfigManager } = require('./config');
const { DatabaseManager } = require('./database');
const { BatchProcessor } = require('./batch-processor');

class ApiServer {
    constructor(config, database, batchProcessor) {
        this.config = config;
        this.database = database;
        this.batchProcessor = batchProcessor;
        this.app = express();
        this.server = null;
        
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
    }
    
    setupMiddleware() {
        // CORS 配置
        this.app.use(cors({
            origin: ['http://localhost:3000', 'http://localhost:5173'],
            credentials: true
        }));
        
        // JSON 解析
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
        
        // 请求日志
        this.app.use((req, res, next) => {
            const start = Date.now();
            res.on('finish', () => {
                const duration = Date.now() - start;
                logger.info(`API Request: ${req.method} ${req.path} ${res.statusCode} ${duration}ms`, {
                    method: req.method,
                    path: req.path,
                    status: res.statusCode,
                    duration,
                    ip: req.ip
                });
            });
            next();
        });
        
        // 静态文件服务
        this.app.use('/static', express.static(path.join(__dirname, '../web')));
    }
    
    setupRoutes() {
        // 健康检查
        this.app.get('/api/health', (req, res) => {
            res.json({
                success: true,
                data: {
                    status: 'healthy',
                    timestamp: new Date().toISOString(),
                    uptime: process.uptime(),
                    version: require('../../package.json').version
                }
            });
        });
        
        // 应用状态
        this.app.get('/api/status', (req, res) => {
            try {
                const status = {
                    running: this.batchProcessor.isRunning(),
                    uptime: process.uptime() * 1000,
                    batchStats: this.batchProcessor.getStats(),
                    config: {
                        inputDir: this.config.get('directories.input'),
                        outputDir: this.config.get('directories.output'),
                        batchSize: this.config.get('batch.size'),
                        maxConcurrent: this.config.get('batch.maxConcurrent')
                    }
                };
                
                res.json({
                    success: true,
                    data: status
                });
            } catch (error) {
                logger.error('获取应用状态失败', { error: error.message });
                res.status(500).json({
                    success: false,
                    error: '获取应用状态失败'
                });
            }
        });
        
        // 配置信息
        this.app.get('/api/config', (req, res) => {
            try {
                const config = this.config.getAll();
                res.json({
                    success: true,
                    data: config
                });
            } catch (error) {
                logger.error('获取配置失败', { error: error.message });
                res.status(500).json({
                    success: false,
                    error: '获取配置失败'
                });
            }
        });
        
        // 更新配置
        this.app.post('/api/config', (req, res) => {
            try {
                const { key, value } = req.body;
                
                if (!key || value === undefined) {
                    return res.status(400).json({
                        success: false,
                        error: '缺少 key 或 value 参数'
                    });
                }
                
                this.config.set(key, value);
                
                logger.info('配置已更新', { key, value });
                
                res.json({
                    success: true,
                    data: { key, value }
                });
            } catch (error) {
                logger.error('更新配置失败', { error: error.message });
                res.status(500).json({
                    success: false,
                    error: '更新配置失败'
                });
            }
        });
        
        // 文件处理记录
        this.app.get('/api/files', (req, res) => {
            try {
                const { 
                    status, 
                    limit = 50, 
                    offset = 0, 
                    startDate, 
                    endDate 
                } = req.query;
                
                const filters = {};
                if (status) filters.status = status;
                if (startDate) filters.startDate = new Date(startDate);
                if (endDate) filters.endDate = new Date(endDate);
                
                const files = this.database.getFileProcessingRecords({
                    ...filters,
                    limit: parseInt(limit),
                    offset: parseInt(offset)
                });
                
                res.json({
                    success: true,
                    data: files,
                    pagination: {
                        limit: parseInt(limit),
                        offset: parseInt(offset),
                        total: files.length
                    }
                });
            } catch (error) {
                logger.error('获取文件记录失败', { error: error.message });
                res.status(500).json({
                    success: false,
                    error: '获取文件记录失败'
                });
            }
        });

        // ===== 调试端点与安全清理（补充） START =====
        const videoExts = new Set(['.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm']);
        const isVideoFile = (filePath) => {
            // 提取并清洗扩展名：去除尾部空白与常见引号符号
            let ext = path.extname(filePath).toLowerCase();
            if (ext) {
                ext = ext.replace(/[\s\u00A0]+$/g, '');
                ext = ext.replace(/["'’“”]+$/g, '');
                if (videoExts.has(ext)) return true;
            }
            // 回退：使用 MIME 类型判断
            try {
                const mime = require('mime-types');
                const mt = mime.lookup(filePath);
                if (mt && String(mt).startsWith('video/')) return true;
            } catch (_) {}
            return false;
        };

        function listFilesRecursive(dir) {
            const files = [];
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const full = path.join(dir, entry.name);
                    if (entry.isFile()) {
                        files.push(full);
                    } else if (entry.isDirectory()) {
                        files.push(...listFilesRecursive(full));
                    }
                }
            } catch {
                // 忽略读取错误
            }
            return files;
        }

        const normalizeBaseName = (name) => name.replace(/_(clean|out|processed|result)$/i, '');

        async function safeDeleteInputFile(filePath, attempts = 3) {
            for (let i = 0; i < attempts; i++) {
                try {
                    if (!fs.existsSync(filePath)) return true;
                    // 确保可写
                    try { fs.chmodSync(filePath, 0o666); } catch {}
                    fs.unlinkSync(filePath);
                    return true;
                } catch (err) {
                    logger.warn('删除源文件失败，准备重试', { filePath, attempt: i + 1, error: err.message });
                    await new Promise(r => setTimeout(r, 250 * (i + 1)));
                }
            }
            logger.error('源文件删除失败（已重试）', { filePath });
            return false;
        }

        // 列出 Input 目录视频文件
        this.app.get('/api/debug/input-files', (req, res) => {
            try {
                const inputDir = this.config.get('directories.input') || path.join(process.cwd(), 'Input');
                const files = listFilesRecursive(inputDir).filter(isVideoFile);
                res.json({ success: true, data: { count: files.length, files } });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message || 'list_input_failed' });
            }
        });

        // 列出 Output 目录视频文件
        this.app.get('/api/debug/output-files', (req, res) => {
            try {
                const outputDir = this.config.get('directories.output') || path.join(process.cwd(), 'Output');
                const files = listFilesRecursive(outputDir).filter(isVideoFile);
                res.json({ success: true, data: { count: files.length, files } });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message || 'list_output_failed' });
            }
        });

        // 安全清理（文件系统）：删除 Input 中已有对应 Output 的源文件
        // 注意：避免与数据清理路由冲突，使用 /api/system/fs-cleanup
        this.app.delete('/api/system/fs-cleanup', async (req, res) => {
            try {
                const inputDir = this.config.get('directories.input') || path.join(process.cwd(), 'Input');
                const outputDir = this.config.get('directories.output') || path.join(process.cwd(), 'Output');
                const inputFiles = listFilesRecursive(inputDir).filter(isVideoFile);
                const outputFiles = listFilesRecursive(outputDir).filter(isVideoFile);

                const outputBase = new Set(outputFiles.map(f => normalizeBaseName(path.parse(path.basename(f)).name)));

                let deleted = 0;
                const deletedList = [];
                const skipped = [];

                for (const inFile of inputFiles) {
                    const base = path.parse(path.basename(inFile)).name;
                    if (outputBase.has(base)) {
                        const ok = await safeDeleteInputFile(inFile, 3);
                        if (ok) {
                            deleted++;
                            deletedList.push(inFile);
                        } else {
                            skipped.push({ file: inFile, reason: 'delete_failed' });
                        }
                    } else {
                        skipped.push({ file: inFile, reason: 'no_matching_output' });
                    }
                }

                res.json({ success: true, data: { deletedFiles: deleted, deletedList, skipped, deletedLogs: 0 } });
            } catch (error) {
                logger.error('安全清理失败', { error: error.message });
                res.status(500).json({ success: false, error: error.message || 'cleanup_failed' });
            }
        });
        // ===== 调试端点与安全清理（补充） END =====

        // 额外：安全清理端点，将 Input 根目录中的视频移动到顶层 Failed
        // 手动兜底，确保任何情况下 Input 不残留已处理或失败文件
        this.app.post('/api/cleanup', async (req, res) => {
            try {
                const inputDir = this.config.get('directories.input') || path.join(process.cwd(), 'Input');
                const failedDir = path.join(process.cwd(), 'Failed');
                try { fs.mkdirSync(failedDir, { recursive: true }); } catch {}

                const entries = fs.readdirSync(inputDir, { withFileTypes: true });
                let moved = 0;
                const results = [];
                for (const entry of entries) {
                    if (!entry.isFile()) continue;
                    const full = path.join(inputDir, entry.name);
                    if (!isVideoFile(full)) continue;
                    // 已在 Failed 顶层则跳过
                    const relToFailed = path.relative(failedDir, full);
                    if (!relToFailed.startsWith('..')) {
                        results.push({ input: full, dest: full, moved: false, error: 'already_in_failed' });
                        continue;
                    }
                    const dest = path.join(failedDir, entry.name);
                    try {
                        try {
                            fs.renameSync(full, dest);
                        } catch (err) {
                            // 回退 copy+unlink
                            fs.copyFileSync(full, dest);
                            try { fs.unlinkSync(full); } catch {}
                        }
                        moved++;
                        results.push({ input: full, dest, moved: true });
                    } catch (err) {
                        results.push({ input: full, dest, moved: false, error: err.message });
                    }
                }

                res.json({ success: true, data: { moved, results } });
            } catch (error) {
                logger.error('安全清理端点失败', { error: error.message });
                res.status(500).json({ success: false, error: error.message || 'cleanup_input_failed' });
            }
        });
        
        // 单个文件记录
        this.app.get('/api/files/:id', (req, res) => {
            try {
                const { id } = req.params;
                const file = this.database.getFileProcessingRecord(id);
                
                if (!file) {
                    return res.status(404).json({
                        success: false,
                        error: '文件记录不存在'
                    });
                }
                
                res.json({
                    success: true,
                    data: file
                });
            } catch (error) {
                logger.error('获取文件记录失败', { error: error.message });
                res.status(500).json({
                    success: false,
                    error: '获取文件记录失败'
                });
            }
        });
        
        // 处理日志
        this.app.get('/api/logs', (req, res) => {
            try {
                const { 
                    level, 
                    limit = 100, 
                    offset = 0, 
                    startDate, 
                    endDate 
                } = req.query;
                
                const filters = {};
                if (level) filters.level = level;
                if (startDate) filters.startDate = new Date(startDate);
                if (endDate) filters.endDate = new Date(endDate);
                
                const logs = this.database.getProcessingLogs({
                    ...filters,
                    limit: parseInt(limit),
                    offset: parseInt(offset)
                });
                
                res.json({
                    success: true,
                    data: logs,
                    pagination: {
                        limit: parseInt(limit),
                        offset: parseInt(offset),
                        total: logs.length
                    }
                });
            } catch (error) {
                logger.error('获取日志失败', { error: error.message });
                res.status(500).json({
                    success: false,
                    error: '获取日志失败'
                });
            }
        });
        
        // 统计信息
        this.app.get('/api/stats', (req, res) => {
            try {
                const stats = this.database.getStatistics();
                
                res.json({
                    success: true,
                    data: stats
                });
            } catch (error) {
                logger.error('获取统计信息失败', { error: error.message });
                res.status(500).json({
                    success: false,
                    error: '获取统计信息失败'
                });
            }
        });
        
        // 批处理任务管理
        this.app.post('/api/batch/start', (req, res) => {
            try {
                if (this.batchProcessor.isRunning()) {
                    return res.status(400).json({
                        success: false,
                        error: '批处理已在运行中'
                    });
                }
                
                this.batchProcessor.startBatch();
                
                logger.info('批处理已启动');
                
                res.json({
                    success: true,
                    data: { message: '批处理已启动' }
                });
            } catch (error) {
                logger.error('启动批处理失败', { error: error.message });
                res.status(500).json({
                    success: false,
                    error: '启动批处理失败'
                });
            }
        });
        
        this.app.post('/api/batch/stop', (req, res) => {
            try {
                if (!this.batchProcessor.isRunning()) {
                    return res.status(400).json({
                        success: false,
                        error: '批处理未在运行'
                    });
                }
                
                this.batchProcessor.stopBatch();
                
                logger.info('批处理已停止');
                
                res.json({
                    success: true,
                    data: { message: '批处理已停止' }
                });
            } catch (error) {
                logger.error('停止批处理失败', { error: error.message });
                res.status(500).json({
                    success: false,
                    error: '停止批处理失败'
                });
            }
        });
        
        // 批处理统计
        this.app.get('/api/batch/stats', (req, res) => {
            try {
                const stats = this.batchProcessor.getStats();
                
                res.json({
                    success: true,
                    data: stats
                });
            } catch (error) {
                logger.error('获取批处理统计失败', { error: error.message });
                res.status(500).json({
                    success: false,
                    error: '获取批处理统计失败'
                });
            }
        });
        
        // 清除已完成任务
        this.app.delete('/api/batch/completed', (req, res) => {
            try {
                const result = this.database.clearCompletedFiles();
                
                logger.info('已完成任务已清除', result);
                
                res.json({
                    success: true,
                    data: result
                });
            } catch (error) {
                logger.error('清除已完成任务失败', { error: error.message });
                res.status(500).json({
                    success: false,
                    error: '清除已完成任务失败'
                });
            }
        });
        
        // 系统配置管理
        this.app.get('/api/system/config', (req, res) => {
            try {
                const config = this.database.getSystemConfig();
                
                res.json({
                    success: true,
                    data: config
                });
            } catch (error) {
                logger.error('获取系统配置失败', { error: error.message });
                res.status(500).json({
                    success: false,
                    error: '获取系统配置失败'
                });
            }
        });
        
        this.app.post('/api/system/config', (req, res) => {
            try {
                const { key, value } = req.body;
                
                if (!key || value === undefined) {
                    return res.status(400).json({
                        success: false,
                        error: '缺少 key 或 value 参数'
                    });
                }
                
                this.database.setSystemConfig(key, value);
                
                logger.info('系统配置已更新', { key, value });
                
                res.json({
                    success: true,
                    data: { key, value }
                });
            } catch (error) {
                logger.error('更新系统配置失败', { error: error.message });
                res.status(500).json({
                    success: false,
                    error: '更新系统配置失败'
                });
            }
        });
        
        // 数据清理
        this.app.delete('/api/system/cleanup', (req, res) => {
            try {
                const { olderThanDays = 30 } = req.query;
                const days = parseInt(olderThanDays);
                
                const result = this.database.cleanupOldData(days);
                
                logger.info('数据清理完成', { days, result });
                
                res.json({
                    success: true,
                    data: result
                });
            } catch (error) {
                logger.error('数据清理失败', { error: error.message });
                res.status(500).json({
                    success: false,
                    error: '数据清理失败'
                });
            }
        });
        
        // 重启应用
        this.app.post('/api/system/restart', (req, res) => {
            try {
                logger.info('应用重启请求已接收');
                
                // 发送响应后重启
                res.json({
                    success: true,
                    data: { message: '应用将在5秒后重启' }
                });
                
                setTimeout(() => {
                    logger.info('正在重启应用...');
                    process.exit(0); // PM2 会自动重启
                }, 5000);
                
            } catch (error) {
                logger.error('重启应用失败', { error: error.message });
                res.status(500).json({
                    success: false,
                    error: '重启应用失败'
                });
            }
        });
        
        // 关闭应用
        this.app.post('/api/system/shutdown', (req, res) => {
            try {
                logger.info('应用关闭请求已接收');
                
                // 发送响应后关闭
                res.json({
                    success: true,
                    data: { message: '应用将在5秒后关闭' }
                });
                
                setTimeout(() => {
                    logger.info('正在关闭应用...');
                    process.exit(0);
                }, 5000);
                
            } catch (error) {
                logger.error('关闭应用失败', { error: error.message });
                res.status(500).json({
                    success: false,
                    error: '关闭应用失败'
                });
            }
        });
        
        // 默认路由 - 服务监控面板
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, '../web/index.html'));
        });
    }
    
    setupErrorHandling() {
        // 404 处理
        this.app.use((req, res) => {
            res.status(404).json({
                success: false,
                error: '接口不存在'
            });
        });
        
        // 全局错误处理
        this.app.use((error, req, res, next) => {
            logger.error('API 错误', {
                error: error.message,
                stack: error.stack,
                path: req.path,
                method: req.method
            });
            
            res.status(500).json({
                success: false,
                error: '服务器内部错误',
                message: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        });
    }
    
    async start() {
        const port = this.config.get('server.port') || 3000;
        const host = this.config.get('server.host') || '0.0.0.0';
        
        return new Promise((resolve, reject) => {
            this.server = this.app.listen(port, host, (error) => {
                if (error) {
                    logger.error(`API服务器启动失败`, { error: error.message });
                    reject(error);
                } else {
                    logger.info(`API服务器已启动`, { host, port });
                    resolve({ host, port });
                }
            });
        });
    }
    
    async stop() {
        if (this.server) {
            return new Promise((resolve) => {
                this.server.close(() => {
                    logger.info('API服务器已停止');
                    resolve();
                });
            });
        }
    }
}

module.exports = { ApiServer };