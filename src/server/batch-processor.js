import { EventEmitter } from 'events';
import { logger } from './logger.js';
import pLimit from 'p-limit';
import fs from 'fs/promises';
import fscb from 'fs';
import path from 'path';

// 确保 Failed 目录存在
async function ensureDir(dir) {
    try { await fs.mkdir(dir, { recursive: true }); } catch {}
}

// 安全删除 Input 源文件（带重试与权限放宽）
async function safeDeleteInputFile(filePath, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
        try {
            try { await fs.chmod(filePath, 0o666); } catch {}
            await fs.unlink(filePath);
            return true;
        } catch (err) {
            logger.warn('删除源文件失败，准备重试', { filePath, attempt: i + 1, error: err.message });
            await new Promise(r => setTimeout(r, 250 * (i + 1)));
        }
    }
    logger.error('源文件删除失败（已重试）', { filePath });
    return false;
}

// 将失败文件移动到顶层 Failed（与 Input/Output 同级；跨设备复制回退）
async function moveFileToFailed(filePath) {
    const projectRoot = process.cwd();
    const failedDir = path.join(projectRoot, 'Failed');
    await ensureDir(failedDir);

    // 已在 Failed 中则跳过，避免 Failed/Failed 嵌套
    const relToFailed = path.relative(failedDir, filePath);
    if (!relToFailed.startsWith('..')) {
        return filePath;
    }

    // 尝试保持相对 Input 的子结构；若不在 Input 下则仅用文件名
    let rel = path.relative(path.join(projectRoot, 'Input'), filePath);
    if (rel.startsWith('..')) {
        rel = path.basename(filePath);
    }
    const dest = path.join(failedDir, rel);
    await ensureDir(path.dirname(dest));
    try {
        await fs.rename(filePath, dest);
        return dest;
    } catch (err) {
        // 可能是跨设备或权限问题，回退为 copy+unlink
        const readStream = fscb.createReadStream(filePath);
        const writeStream = fscb.createWriteStream(dest);
        await new Promise((resolve, reject) => {
            readStream.on('error', reject);
            writeStream.on('error', reject);
            writeStream.on('finish', resolve);
            readStream.pipe(writeStream);
        });
        try { await fs.unlink(filePath); } catch {}
        return dest;
    }
}

/**
 * 批处理器类
 * 负责管理和执行视频文件的批量去水印处理
 */
export class BatchProcessor extends EventEmitter {
    constructor(soraApiClient, options = {}) {
        super();
        
        this.soraApiClient = soraApiClient;
        this.batchSize = options.batchSize || 5;
        this.concurrentLimit = options.concurrentLimit || 3;
        this.retryCount = options.retryCount || 3;
        this.retryDelay = options.retryDelay || 5000;
        
        this.processingQueue = [];
        this.activeJobs = new Map();
        this.completedJobs = [];
        this.failedJobs = [];
        this.isProcessing = false;
        this.currentBatchId = 0;
        
        this.limit = pLimit(this.concurrentLimit);
        
        logger.info('批处理器初始化完成', {
            batchSize: this.batchSize,
            concurrentLimit: this.concurrentLimit,
            retryCount: this.retryCount
        });
    }
    
    /**
     * 添加文件到处理队列
     */
    async addFiles(fileInfos) {
        if (!Array.isArray(fileInfos)) {
            fileInfos = [fileInfos];
        }
        
        const validFiles = [];
        
        for (const fileInfo of fileInfos) {
            // 验证文件信息
            if (!this.validateFileInfo(fileInfo)) {
                logger.warning('无效的文件信息，跳过', { fileInfo });
                continue;
            }
            
            // 检查文件是否已经在队列中
            const existsInQueue = this.processingQueue.some(item => 
                item.filePath === fileInfo.filePath && item.status === 'pending'
            );
            
            const existsInActive = this.activeJobs.has(fileInfo.filePath);
            
            if (existsInQueue || existsInActive) {
                logger.debug('文件已在处理队列中，跳过', { filePath: fileInfo.filePath });
                continue;
            }
            
            // 创建处理任务
            const job = {
                id: this.generateJobId(),
                filePath: fileInfo.filePath,
                outputPath: fileInfo.outputPath,
                relativePath: fileInfo.relativePath,
                fileSize: fileInfo.fileSize || 0,
                status: 'pending',
                progress: 0,
                attempt: 0,
                createdAt: new Date(),
                startedAt: null,
                completedAt: null,
                error: null,
                processingTime: 0
            };
            
            validFiles.push(job);
            this.processingQueue.push(job);
            
            logger.info('文件已添加到处理队列', {
                jobId: job.id,
                filePath: job.filePath,
                outputPath: job.outputPath
            });
        }
        
        // 触发事件
        this.emit('filesAdded', validFiles);
        
        // 如果正在处理，继续处理队列
        if (this.isProcessing) {
            this.processQueue();
        }
        
        return validFiles;
    }
    
    /**
     * 开始批处理
     */
    async start() {
        if (this.isProcessing) {
            logger.warning('批处理器已在运行中');
            return;
        }
        
        logger.info('开始批处理');
        this.isProcessing = true;
        this.currentBatchId++;
        
        this.emit('processingStarted', {
            batchId: this.currentBatchId,
            queueSize: this.processingQueue.length
        });
        
        // 开始处理队列
        this.processQueue();
    }
    
    /**
     * 停止批处理
     */
    async stop() {
        if (!this.isProcessing) {
            logger.warning('批处理器未在运行');
            return;
        }
        
        logger.info('正在停止批处理...');
        this.isProcessing = false;
        
        // 等待当前活动任务完成
        const activeJobs = Array.from(this.activeJobs.values());
        if (activeJobs.length > 0) {
            logger.info(`等待 ${activeJobs.length} 个活动任务完成...`);
            await Promise.allSettled(activeJobs.map(job => job.promise));
        }
        
        this.emit('processingStopped', {
            batchId: this.currentBatchId,
            completed: this.completedJobs.length,
            failed: this.failedJobs.length
        });
        
        logger.info('批处理已停止');
    }
    
    /**
     * 处理队列
     */
    async processQueue() {
        if (!this.isProcessing) {
            return;
        }
        
        // 获取待处理的任务
        const pendingJobs = this.processingQueue.filter(job => job.status === 'pending');
        
        if (pendingJobs.length === 0) {
            logger.info('处理队列已空');
            
            // 检查是否所有任务都已完成
            if (this.activeJobs.size === 0) {
                this.emit('processingCompleted', {
                    batchId: this.currentBatchId,
                    completed: this.completedJobs.length,
                    failed: this.failedJobs.length
                });
            }
            
            return;
        }
        
        // 按批次大小分组处理
        const batch = pendingJobs.slice(0, this.batchSize);
        
        logger.info(`开始处理批次，包含 ${batch.length} 个文件`, {
            batchId: this.currentBatchId,
            remaining: pendingJobs.length - batch.length
        });
        
        // 并发处理批次中的任务
        const promises = batch.map(job => 
            this.limit(async () => {
                await this.processJob(job);
            })
        );
        
        await Promise.allSettled(promises);
        
        // 继续处理剩余任务
        if (this.isProcessing) {
            setTimeout(() => this.processQueue(), 100);
        }
    }
    
    /**
     * 处理单个任务
     */
    async processJob(job) {
        job.status = 'processing';
        job.startedAt = new Date();
        job.attempt++;
        
        this.activeJobs.set(job.filePath, job);
        
        logger.info('开始处理任务', {
            jobId: job.id,
            filePath: job.filePath,
            attempt: job.attempt
        });
        
        this.emit('jobStarted', job);
        
        try {
            // 处理文件
            await this.processVideoFile(job);
            
            job.status = 'completed';
            job.completedAt = new Date();
            job.processingTime = job.completedAt - job.startedAt;
            job.progress = 100;
            
            this.completedJobs.push(job);
            this.activeJobs.delete(job.filePath);
            
            logger.info('任务处理完成', {
                jobId: job.id,
                filePath: job.filePath,
                processingTime: job.processingTime,
                attempt: job.attempt
            });
            
            this.emit('jobCompleted', job);

            // 成功后删除 Input 源文件，保持 Input 干净
            try {
                const ok = await safeDeleteInputFile(job.filePath, 3);
                if (!ok) {
                    job.deleteError = 'delete_failed_after_retries';
                }
            } catch (e) {
                job.deleteError = e?.message || String(e);
            }
            
        } catch (error) {
            job.error = error.message;
            
            // 检查是否还可以重试
            if (job.attempt < this.retryCount) {
                logger.warning(`任务处理失败，准备重试`, {
                    jobId: job.id,
                    filePath: job.filePath,
                    attempt: job.attempt,
                    error: error.message
                });
                
                job.status = 'pending';
                job.progress = 0;
                
                // 延迟后重新加入队列
                setTimeout(() => {
                    this.processingQueue.push(job);
                    this.activeJobs.delete(job.filePath);
                }, this.retryDelay * job.attempt);
                
                this.emit('jobRetry', job);
                
            } else {
                // 重试次数用完，标记为失败
                job.status = 'failed';
                job.completedAt = new Date();
                job.processingTime = job.completedAt - job.startedAt;
                
                this.failedJobs.push(job);
                this.activeJobs.delete(job.filePath);
                
                logger.error('任务处理失败（重试次数已用完）', {
                    jobId: job.id,
                    filePath: job.filePath,
                    attempt: job.attempt,
                    error: error.message
                });
                // 失败后移动到 Input/Failed，避免 Input 堆积
                try {
                    const dest = await moveFileToFailed(job.filePath);
                    job.movedToFailed = true;
                    job.failedDest = dest;
                } catch (e) {
                    job.moveFailedError = e?.message || String(e);
                }
                
                this.emit('jobFailed', job);
            }
        }
    }
    
    /**
     * 处理视频文件
     */
    async processVideoFile(job) {
        const startTime = Date.now();
        
        try {
            // 调用API处理视频
            const result = await this.soraApiClient.processVideo(job.filePath, {
                onProgress: (progress) => {
                    job.progress = progress.progress || 0;
                    this.emit('jobProgress', {
                        ...job,
                        progress: job.progress
                    });
                }
            });
            
            if (!result.success) {
                throw new Error(`API处理失败: ${result.error}`);
            }
            
            // 如果API返回了下载URL，下载处理完成的文件
            if (result.data?.download_url) {
                logger.info('下载处理完成的文件', {
                    jobId: job.id,
                    downloadUrl: result.data.download_url,
                    outputPath: job.outputPath
                });
                
                const downloadResult = await this.soraApiClient.downloadProcessedVideo(
                    result.data.download_url,
                    job.outputPath,
                    {
                        onProgress: (progress) => {
                            job.progress = Math.max(job.progress, 90 + (progress.progress || 0) * 0.1);
                            this.emit('jobProgress', {
                                ...job,
                                progress: job.progress
                            });
                        }
                    }
                );
                
                if (!downloadResult.success) {
                    throw new Error(`文件下载失败: ${downloadResult.error}`);
                }
                
                logger.info('文件下载完成', {
                    jobId: job.id,
                    outputPath: job.outputPath,
                    size: downloadResult.size
                });
            }
            
            const processingTime = Date.now() - startTime;
            
            return {
                success: true,
                outputPath: job.outputPath,
                processingTime,
                apiResult: result
            };
            
        } catch (error) {
            logger.error('处理视频文件失败', {
                jobId: job.id,
                filePath: job.filePath,
                error: error.message
            });
            
            throw error;
        }
    }
    
    /**
     * 验证文件信息
     */
    validateFileInfo(fileInfo) {
        if (!fileInfo.filePath) {
            logger.error('文件路径为空');
            return false;
        }
        
        if (!fileInfo.outputPath) {
            logger.error('输出路径为空', { filePath: fileInfo.filePath });
            return false;
        }
        
        return true;
    }
    
    /**
     * 生成任务ID
     */
    generateJobId() {
        return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * 获取处理统计
     */
    getStats() {
        const total = this.completedJobs.length + this.failedJobs.length + this.processingQueue.length + this.activeJobs.size;
        
        return {
            total,
            pending: this.processingQueue.filter(job => job.status === 'pending').length,
            processing: this.activeJobs.size,
            completed: this.completedJobs.length,
            failed: this.failedJobs.length,
            isProcessing: this.isProcessing,
            currentBatchId: this.currentBatchId,
            batchSize: this.batchSize,
            concurrentLimit: this.concurrentLimit
        };
    }
    
    /**
     * 获取任务列表
     */
    getJobs(status = null) {
        let jobs = [];
        
        if (status === null || status === 'pending') {
            jobs = jobs.concat(this.processingQueue.filter(job => job.status === 'pending'));
        }
        
        if (status === null || status === 'processing') {
            jobs = jobs.concat(Array.from(this.activeJobs.values()));
        }
        
        if (status === null || status === 'completed') {
            jobs = jobs.concat(this.completedJobs);
        }
        
        if (status === null || status === 'failed') {
            jobs = jobs.concat(this.failedJobs);
        }
        
        return jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    
    /**
     * 清除已完成和失败的任务
     */
    clearCompletedJobs() {
        const completedCount = this.completedJobs.length;
        const failedCount = this.failedJobs.length;
        
        this.completedJobs = [];
        this.failedJobs = [];
        
        logger.info('已清除完成任务', { completed: completedCount, failed: failedCount });
        
        return {
            completed: completedCount,
            failed: failedCount
        };
    }
    
    /**
     * 获取特定任务
     */
    getJob(jobId) {
        const allJobs = this.getJobs();
        return allJobs.find(job => job.id === jobId);
    }
    
    /**
     * 取消特定任务
     */
    cancelJob(jobId) {
        const job = this.getJob(jobId);
        
        if (!job) {
            return { success: false, error: '任务未找到' };
        }
        
        if (job.status === 'processing') {
            return { success: false, error: '任务正在处理中，无法取消' };
        }
        
        if (job.status === 'pending') {
            job.status = 'cancelled';
            job.completedAt = new Date();
            
            // 从队列中移除
            this.processingQueue = this.processingQueue.filter(j => j.id !== jobId);
            
            logger.info('任务已取消', { jobId });
            
            this.emit('jobCancelled', job);
            
            return { success: true, job };
        }
        
        return { success: false, error: '任务状态不允许取消' };
    }
}

export default BatchProcessor;