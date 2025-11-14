import { EventEmitter } from 'events';
import { logger } from './logger.js';
import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import mime from 'mime-types';

const __filename = fileURLToPath(import.meta.url);

/**
 * 文件监控器类
 * 负责监控Input文件夹及其子目录的视频文件变化
 */
export class FileMonitor extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.inputDir = options.inputDir || path.join(process.cwd(), 'Input');
        this.outputDir = options.outputDir || path.join(process.cwd(), 'Output');
        this.supportedFormats = options.supportedFormats || ['mp4', 'mov', 'avi', 'mkv', 'wmv'];
        this.maxFileSize = options.maxFileSize || 500 * 1024 * 1024; // 500MB
        this.debounceDelay = options.debounceDelay || 1000; // 1秒防抖
        
        this.watcher = null;
        this.pendingFiles = new Map(); // 防抖待处理文件
        this.processingFiles = new Set(); // 正在处理的文件
        
        this.init();
    }
    
    /**
     * 初始化监控器
     */
    async init() {
        try {
            logger.info('初始化文件监控器', {
                inputDir: this.inputDir,
                outputDir: this.outputDir,
                supportedFormats: this.supportedFormats
            });
            
            // 确保目录存在
            await this.ensureDirectories();
            
            // 创建文件监控器
            this.createWatcher();
            
            logger.info('文件监控器初始化完成');
        } catch (error) {
            logger.error('文件监控器初始化失败', { error: error.message });
            throw error;
        }
    }
    
    /**
     * 确保必要的目录存在
     */
    async ensureDirectories() {
        const fs = await import('fs/promises');
        
        try {
            await fs.access(this.inputDir);
        } catch {
            await fs.mkdir(this.inputDir, { recursive: true });
            logger.info('创建Input目录', { path: this.inputDir });
        }
        
        try {
            await fs.access(this.outputDir);
        } catch {
            await fs.mkdir(this.outputDir, { recursive: true });
            logger.info('创建Output目录', { path: this.outputDir });
        }
    }
    
    /**
     * 创建文件监控器
     */
    createWatcher() {
        this.watcher = chokidar.watch(this.inputDir, {
            ignored: /(^|[\/\\])\../, // 忽略隐藏文件
            persistent: true,
            ignoreInitial: false, // 也处理已存在的文件
            followSymlinks: false,
            depth: 10, // 最大递归深度
            awaitWriteFinish: {
                stabilityThreshold: 2000, // 2秒稳定性阈值
                pollInterval: 100
            }
        });
        
        // 绑定事件处理器
        this.watcher
            .on('add', (filePath) => this.handleFileAdded(filePath))
            .on('change', (filePath) => this.handleFileChanged(filePath))
            .on('unlink', (filePath) => this.handleFileRemoved(filePath))
            .on('error', (error) => this.handleWatcherError(error));
            
        logger.info('文件监控器已启动', { inputDir: this.inputDir });
    }
    
    /**
     * 处理文件添加事件
     */
    async handleFileAdded(filePath) {
        try {
            // 检查是否是视频文件
            if (!this.isVideoFile(filePath)) {
                return;
            }
            
            // 检查文件大小
            const stats = await this.getFileStats(filePath);
            if (!stats || stats.size > this.maxFileSize) {
                logger.warning('文件大小超出限制', { 
                    filePath, 
                    size: stats?.size,
                    maxSize: this.maxFileSize 
                });
                return;
            }
            
            logger.info('检测到新视频文件', { filePath, size: stats.size });
            
            // 防抖处理
            this.debounceFileProcessing(filePath, 'add');
            
        } catch (error) {
            logger.error('处理文件添加事件失败', { filePath, error: error.message });
        }
    }
    
    /**
     * 处理文件修改事件
     */
    async handleFileChanged(filePath) {
        try {
            if (!this.isVideoFile(filePath)) {
                return;
            }
            
            // 如果文件正在处理，跳过
            if (this.processingFiles.has(filePath)) {
                logger.debug('文件正在处理中，跳过修改事件', { filePath });
                return;
            }
            
            logger.info('检测到视频文件修改', { filePath });
            
            // 防抖处理
            this.debounceFileProcessing(filePath, 'change');
            
        } catch (error) {
            logger.error('处理文件修改事件失败', { filePath, error: error.message });
        }
    }
    
    /**
     * 处理文件删除事件
     */
    handleFileRemoved(filePath) {
        try {
            if (!this.isVideoFile(filePath)) {
                return;
            }
            
            logger.info('检测到视频文件删除', { filePath });
            
            // 取消待处理任务
            if (this.pendingFiles.has(filePath)) {
                clearTimeout(this.pendingFiles.get(filePath).timer);
                this.pendingFiles.delete(filePath);
                logger.info('取消待处理任务', { filePath });
            }
            
            // 从处理中集合移除
            this.processingFiles.delete(filePath);
            
            this.emit('fileRemoved', { filePath });
            
        } catch (error) {
            logger.error('处理文件删除事件失败', { filePath, error: error.message });
        }
    }
    
    /**
     * 处理监控器错误
     */
    handleWatcherError(error) {
        logger.error('文件监控器错误', { error: error.message });
        this.emit('error', error);
    }
    
    /**
     * 防抖文件处理
     */
    debounceFileProcessing(filePath, eventType) {
        // 取消之前的定时器
        if (this.pendingFiles.has(filePath)) {
            clearTimeout(this.pendingFiles.get(filePath).timer);
        }
        
        // 设置新的定时器
        const timer = setTimeout(async () => {
            try {
                this.pendingFiles.delete(filePath);
                
                // 检查文件是否完整
                const isReady = await this.isFileReady(filePath);
                if (!isReady) {
                    logger.debug('文件尚未准备好，跳过处理', { filePath });
                    return;
                }
                
                // 生成输出路径
                const outputPath = this.generateOutputPath(filePath);
                
                // 添加到处理队列
                const fileInfo = {
                    filePath,
                    outputPath,
                    eventType,
                    fileSize: (await this.getFileStats(filePath))?.size || 0,
                    relativePath: path.relative(this.inputDir, filePath)
                };
                
                this.emit('fileReady', fileInfo);
                
            } catch (error) {
                logger.error('防抖处理失败', { filePath, error: error.message });
            }
        }, this.debounceDelay);
        
        this.pendingFiles.set(filePath, { timer, eventType });
    }
    
    /**
     * 检查文件是否准备好（完成写入）
     */
    async isFileReady(filePath) {
        try {
            const fs = await import('fs/promises');
            const stats = await fs.stat(filePath);
            
            // 检查文件大小是否稳定
            await new Promise(resolve => setTimeout(resolve, 1000));
            const newStats = await fs.stat(filePath);
            
            return stats.size === newStats.size && stats.mtime.getTime() === newStats.mtime.getTime();
        } catch (error) {
            logger.error('检查文件状态失败', { filePath, error: error.message });
            return false;
        }
    }
    
    /**
     * 生成输出文件路径
     * 保持与输入文件相同的目录结构
     */
    generateOutputPath(inputPath) {
        const relativePath = path.relative(this.inputDir, inputPath);
        const parsedPath = path.parse(relativePath);
        
        // 在Output目录中保持相同的目录结构
        const outputDir = path.join(this.outputDir, parsedPath.dir);
        const outputFileName = `${parsedPath.name}_clean${parsedPath.ext}`;
        
        return path.join(outputDir, outputFileName);
    }
    
    /**
     * 检查是否是视频文件
     */
    isVideoFile(filePath) {
        const ext = path.extname(filePath).toLowerCase().slice(1);
        const mimeType = mime.lookup(filePath);
        
        // 检查文件扩展名
        if (this.supportedFormats.includes(ext)) {
            return true;
        }
        
        // 检查MIME类型
        if (mimeType && mimeType.startsWith('video/')) {
            return true;
        }
        
        return false;
    }
    
    /**
     * 获取文件统计信息
     */
    async getFileStats(filePath) {
        try {
            const fs = await import('fs/promises');
            return await fs.stat(filePath);
        } catch (error) {
            logger.error('获取文件统计信息失败', { filePath, error: error.message });
            return null;
        }
    }
    
    /**
     * 获取待处理文件列表
     */
    getPendingFiles() {
        return Array.from(this.pendingFiles.keys());
    }
    
    /**
     * 获取正在处理的文件列表
     */
    getProcessingFiles() {
        return Array.from(this.processingFiles);
    }
    
    /**
     * 标记文件为正在处理
     */
    markFileAsProcessing(filePath) {
        this.processingFiles.add(filePath);
        logger.debug('标记文件为处理中', { filePath });
    }
    
    /**
     * 标记文件处理完成
     */
    markFileAsCompleted(filePath) {
        this.processingFiles.delete(filePath);
        logger.debug('标记文件处理完成', { filePath });
    }
    
    /**
     * 停止监控
     */
    async stop() {
        try {
            logger.info('正在停止文件监控器...');
            
            // 取消所有待处理任务
            for (const [filePath, { timer }] of this.pendingFiles) {
                clearTimeout(timer);
                logger.debug('取消待处理任务', { filePath });
            }
            this.pendingFiles.clear();
            
            // 停止文件监控器
            if (this.watcher) {
                await this.watcher.close();
                this.watcher = null;
                logger.info('文件监控器已停止');
            }
            
            this.removeAllListeners();
            
        } catch (error) {
            logger.error('停止文件监控器失败', { error: error.message });
            throw error;
        }
    }
    
    /**
     * 获取监控统计信息
     */
    getStats() {
        return {
            pendingFiles: this.pendingFiles.size,
            processingFiles: this.processingFiles.size,
            inputDirectory: this.inputDir,
            outputDirectory: this.outputDir,
            supportedFormats: this.supportedFormats,
            maxFileSize: this.maxFileSize,
            isWatching: !!this.watcher
        };
    }
}

export default FileMonitor;