const path = require('path');
const { ConfigManager } = require('./config');
const { logger } = require('./logger');
const { DatabaseManager } = require('./database');
const { SoraApiClient } = require('./sora-api-client');
const { BatchProcessor } = require('./batch-processor');
const { FileMonitor } = require('./file-monitor');
const { ApiServer } = require('./api-server');

class SoraWatermarkApp {
    constructor() {
        this.config = new ConfigManager();
        this.database = new DatabaseManager(this.config);
        this.soraClient = new SoraApiClient(this.config);
        this.batchProcessor = new BatchProcessor(this.config, this.database, this.soraClient);
        this.fileMonitor = new FileMonitor(this.config);
        this.apiServer = new ApiServer(this.config, this.database, this.batchProcessor);
        
        this.isShuttingDown = false;
        this.processingFiles = new Set();
        
        this.setupEventHandlers();
        this.setupSignalHandlers();
    }
    
    setupEventHandlers() {
        // 文件监控事件
        this.fileMonitor.on('fileAdded', (filePath) => {
            logger.info('检测到新文件', { filePath });
            this.handleNewFile(filePath);
        });
        
        this.fileMonitor.on('fileModified', (filePath) => {
            logger.info('检测到文件修改', { filePath });
            this.handleModifiedFile(filePath);
        });
        
        this.fileMonitor.on('fileDeleted', (filePath) => {
            logger.info('检测到文件删除', { filePath });
            this.handleDeletedFile(filePath);
        });
        
        // 批处理事件
        this.batchProcessor.on('taskStarted', (taskId, filePath) => {
            logger.info('批处理任务开始', { taskId, filePath });
            this.processingFiles.add(filePath);
        });
        
        this.batchProcessor.on('taskCompleted', (taskId, filePath, result) => {
            logger.info('批处理任务完成', { taskId, filePath, result });
            this.processingFiles.delete(filePath);
            this.recordProcessingSummary(filePath, 'completed', result);
        });
        
        this.batchProcessor.on('taskFailed', (taskId, filePath, error) => {
            logger.error('批处理任务失败', { taskId, filePath, error });
            this.processingFiles.delete(filePath);
            this.recordProcessingSummary(filePath, 'failed', null, error);
        });
        
        this.batchProcessor.on('batchCompleted', (stats) => {
            logger.info('批处理完成', stats);
        });
    }
    
    setupSignalHandlers() {
        const gracefulShutdown = async (signal) => {
            logger.info(`收到 ${signal} 信号，开始优雅关闭...`);
            await this.shutdown();
            process.exit(0);
        };
        
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        
        // 处理未捕获的异常
        process.on('uncaughtException', (error) => {
            logger.error('未捕获的异常', { error: error.message, stack: error.stack });
            this.shutdown().then(() => process.exit(1));
        });
        
        process.on('unhandledRejection', (reason, promise) => {
            logger.error('未处理的Promise拒绝', { reason, promise });
            this.shutdown().then(() => process.exit(1));
        });
    }
    
    async ensureDirectories() {
        const fs = require('fs').promises;
        
        try {
            const inputDir = this.config.get('directories.input');
            const outputDir = this.config.get('directories.output');
            const logDir = this.config.get('directories.logs');
            
            await fs.mkdir(inputDir, { recursive: true });
            await fs.mkdir(outputDir, { recursive: true });
            await fs.mkdir(logDir, { recursive: true });
            
            logger.info('目录检查完成', { inputDir, outputDir, logDir });
        } catch (error) {
            logger.error('创建目录失败', { error: error.message });
            throw error;
        }
    }
    
    async handleNewFile(filePath) {
        try {
            // 检查是否已经在处理中
            if (this.processingFiles.has(filePath)) {
                logger.info('文件已在处理中，跳过', { filePath });
                return;
            }
            
            // 添加到批处理队列
            this.batchProcessor.addFile(filePath);
            
            // 记录文件处理开始
            this.database.insertFileProcessingRecord({
                filePath,
                status: 'pending',
                fileSize: await this.getFileSize(filePath),
                createdAt: new Date().toISOString()
            });
            
        } catch (error) {
            logger.error('处理新文件失败', { filePath, error: error.message });
        }
    }
    
    async handleModifiedFile(filePath) {
        try {
            // 如果文件正在处理中，先取消当前任务
            if (this.processingFiles.has(filePath)) {
                logger.info('文件修改，取消当前处理', { filePath });
                // 这里可以实现任务取消逻辑
                this.processingFiles.delete(filePath);
            }
            
            // 重新处理文件
            await this.handleNewFile(filePath);
            
        } catch (error) {
            logger.error('处理文件修改失败', { filePath, error: error.message });
        }
    }
    
    async handleDeletedFile(filePath) {
        try {
            // 如果文件正在处理中，取消处理
            if (this.processingFiles.has(filePath)) {
                logger.info('文件删除，取消处理', { filePath });
                this.processingFiles.delete(filePath);
            }
            
            // 更新数据库记录
            this.database.updateFileProcessingRecord(filePath, {
                status: 'failed',
                error: '文件被删除',
                updatedAt: new Date().toISOString()
            });
            
        } catch (error) {
            logger.error('处理文件删除失败', { filePath, error: error.message });
        }
    }
    
    async getFileSize(filePath) {
        try {
            const fs = require('fs').promises;
            const stats = await fs.stat(filePath);
            return stats.size;
        } catch (error) {
            logger.warn('获取文件大小失败', { filePath, error: error.message });
            return 0;
        }
    }
    
    recordProcessingSummary(filePath, status, result, error = null) {
        try {
            const processingTime = result ? result.processingTime : null;
            const outputFilePath = result ? result.outputFilePath : null;
            
            this.database.updateFileProcessingRecord(filePath, {
                status,
                outputFilePath,
                processingTime,
                error: error ? error.message : null,
                completedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
            
            // 记录处理日志
            this.database.insertProcessingLog({
                level: status === 'failed' ? 'error' : 'info',
                message: `文件处理${status === 'completed' ? '完成' : '失败'}`,
                filePath,
                error: error ? error.message : null,
                processingTime,
                timestamp: new Date().toISOString()
            });
            
        } catch (logError) {
            logger.error('记录处理摘要失败', { filePath, error: logError.message });
        }
    }
    
    async start() {
        try {
            logger.info('🚀 Sora 去水印应用启动中...');
            
            // 初始化数据库
            await this.database.initialize();
            logger.info('✅ 数据库初始化完成');
            
            // 确保目录存在
            await this.ensureDirectories();
            logger.info('✅ 目录检查完成');
            
            // 启动API服务器
            const serverInfo = await this.apiServer.start();
            logger.info(`✅ API服务器启动完成`, serverInfo);
            
            // 启动文件监控
            await this.fileMonitor.start();
            logger.info('✅ 文件监控已启动');
            
            // 启动批处理处理器
            this.batchProcessor.start();
            logger.info('✅ 批处理处理器已启动');
            
            logger.info('🎉 Sora 去水印应用启动成功！');
            logger.info(`📊 监控面板地址: http://localhost:${serverInfo.port}`);
            logger.info(`📁 输入目录: ${this.config.get('directories.input')}`);
            logger.info(`📁 输出目录: ${this.config.get('directories.output')}`);
            
            // 启动时处理现有文件
            await this.processExistingFiles();
            
        } catch (error) {
            logger.error('应用启动失败', { error: error.message });
            throw error;
        }
    }
    
    async processExistingFiles() {
        try {
            const inputDir = this.config.get('directories.input');
            
            logger.info('开始扫描现有文件...');
            
            const files = await this.scanDirectory(inputDir);
            logger.info(`发现 ${files.length} 个现有文件`);
            
            // 分批处理现有文件
            const batchSize = this.config.get('batch.size');
            for (let i = 0; i < files.length; i += batchSize) {
                const batch = files.slice(i, i + batchSize);
                
                for (const filePath of batch) {
                    await this.handleNewFile(filePath);
                }
                
                // 等待当前批次处理完成
                await this.waitForBatchCompletion(batch);
            }
            
            logger.info('现有文件处理完成');
            
        } catch (error) {
            logger.error('处理现有文件失败', { error: error.message });
        }
    }
    
    async scanDirectory(dir, files = []) {
        try {
            const fs = require('fs').promises;
            const entries = await fs.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isDirectory()) {
                    await this.scanDirectory(fullPath, files);
                } else if (this.isVideoFile(entry.name)) {
                    files.push(fullPath);
                }
            }
            
            return files;
        } catch (error) {
            logger.error('扫描目录失败', { dir, error: error.message });
            return files;
        }
    }
    
    isVideoFile(fileName) {
        const videoExtensions = new Set(['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm']);
        // 提取并清洗扩展名：去除尾部空白与常见引号符号
        let ext = path.extname(fileName).toLowerCase();
        if (ext) {
            ext = ext.replace(/[\s\u00A0]+$/g, ''); // 去除空格与不间断空格
            ext = ext.replace(/["'’“”]+$/g, ''); // 去除可能拼接在末尾的引号
            if (videoExtensions.has(ext)) return true;
        }
        // 回退：使用 MIME 类型判断（文件名含特殊字符时更稳健）
        try {
            const mime = require('mime-types');
            const mt = mime.lookup(fileName);
            if (mt && String(mt).startsWith('video/')) return true;
        } catch (_) {}
        return false;
    }
    
    async waitForBatchCompletion(batch) {
        const maxWaitTime = 30000; // 30秒
        const checkInterval = 1000; // 1秒
        const startTime = Date.now();
        
        while (Date.now() - startTime < maxWaitTime) {
            const remainingFiles = batch.filter(file => this.processingFiles.has(file));
            
            if (remainingFiles.length === 0) {
                break;
            }
            
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }
    }
    
    async shutdown() {
        if (this.isShuttingDown) {
            return;
        }
        
        this.isShuttingDown = true;
        logger.info('正在关闭应用...');
        
        try {
            // 停止文件监控
            if (this.fileMonitor) {
                await this.fileMonitor.stop();
                logger.info('文件监控已停止');
            }
            
            // 停止批处理处理器
            if (this.batchProcessor) {
                this.batchProcessor.stop();
                logger.info('批处理处理器已停止');
            }
            
            // 停止API服务器
            if (this.apiServer) {
                await this.apiServer.stop();
                logger.info('API服务器已停止');
            }
            
            // 关闭数据库连接
            if (this.database) {
                await this.database.close();
                logger.info('数据库连接已关闭');
            }
            
            logger.info('应用已优雅关闭');
            
        } catch (error) {
            logger.error('关闭应用时出错', { error: error.message });
        }
    }
    
    getStatus() {
        return {
            running: !this.isShuttingDown,
            fileMonitor: this.fileMonitor ? this.fileMonitor.isRunning() : false,
            batchProcessor: this.batchProcessor ? this.batchProcessor.isRunning() : false,
            apiServer: this.apiServer ? true : false,
            processingFiles: Array.from(this.processingFiles),
            uptime: process.uptime() * 1000
        };
    }
}

async function main() {
    const app = new SoraWatermarkApp();
    
    try {
        await app.start();
        
        // 导出应用实例供其他模块使用
        global.soraApp = app;
        
    } catch (error) {
        logger.error('应用启动失败', { error: error.message });
        process.exit(1);
    }
}

// 如果直接运行此文件
if (require.main === module) {
    main();
}

module.exports = { SoraWatermarkApp, main };