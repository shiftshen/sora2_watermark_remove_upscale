import axios from 'axios';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import { logger } from './logger.js';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * SoraWatermarkCleaner API客户端
 * 负责与去水印API进行交互
 */
export class SoraApiClient {
    constructor(options = {}) {
        this.baseURL = options.baseURL || 'https://sora.xmanx.com';
        try {
            const trimmed = String(this.baseURL).replace(/\/+$/, '');
            if (trimmed.endsWith('/api')) {
                this.baseURL = trimmed.replace(/\/api$/, '');
            }
        } catch {}
        this.apiKey = options.apiKey || '';
        this.timeout = options.timeout || 300000; // 5分钟
        this.retryCount = options.retryCount || 3;
        this.retryDelay = options.retryDelay || 5000; // 5秒
        
        this.client = axios.create({
            baseURL: this.baseURL,
            timeout: this.timeout,
            headers: {
                'User-Agent': 'SoraWatermarkRemover/1.0.0',
                'Accept': 'application/json'
            }
        });
        
        this.setupInterceptors();
    }
    
    /**
     * 设置请求拦截器
     */
    setupInterceptors() {
        // 请求拦截器
        this.client.interceptors.request.use(
            (config) => {
                if (this.apiKey) {
                    config.headers['Authorization'] = `Bearer ${this.apiKey}`;
                }
                try {
                    const endsWithApi = String(this.baseURL || '').replace(/\/+$/, '').endsWith('/api');
                    if (endsWithApi && typeof config.url === 'string' && config.url.startsWith('/api/')) {
                        config.url = config.url.replace(/^\/api\//, '/');
                    }
                } catch {}
                
                logger.debug('API请求', {
                    method: config.method,
                    url: config.url,
                    headers: config.headers
                });
                
                return config;
            },
            (error) => {
                logger.error('请求拦截器错误', { error: error.message });
                return Promise.reject(error);
            }
        );
        
        // 响应拦截器
        this.client.interceptors.response.use(
            (response) => {
                logger.debug('API响应', {
                    status: response.status,
                    statusText: response.statusText,
                    data: response.data
                });
                
                return response;
            },
            (error) => {
                logger.error('API响应错误', {
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    data: error.response?.data,
                    message: error.message
                });
                
                return Promise.reject(error);
            }
        );
    }
    
    /**
     * 健康检查
     */
    async healthCheck(options = {}) {
        const start = Date.now();
        try {
            // 优先尝试根路径，很多服务会返回首页或重定向
            const resp = await this.client.get('/', { timeout: options.timeout || 8000, validateStatus: () => true });
            return {
                success: true,
                status: resp.status,
                data: resp.data,
                latencyMs: Date.now() - start,
                endpoint: '/'
            };
        } catch (e1) {
            // 备用：尝试一个“不会存在”的结果接口，以确认网络连通性（期望得到非 522 的响应）
            try {
                const resp2 = await this.client.get('/api/get_results/0', { timeout: options.timeout || 8000, validateStatus: () => true });
                return {
                    success: true,
                    status: resp2.status,
                    data: resp2.data,
                    latencyMs: Date.now() - start,
                    endpoint: '/api/get_results/0'
                };
            } catch (e2) {
                return {
                    success: false,
                    error: e2.message || e1.message,
                    status: e2.response?.status,
                    latencyMs: Date.now() - start
                };
            }
        }
    }

    buildSubmitEndpoints() {
        return ['/api/submit_task', '/submit_task', '/api/v1/submit_task', '/api/upload', '/api/v1/upload', '/api/tasks/submit'];
    }
    buildResultsEndpoints(taskId) {
        return [`/api/get_results/${taskId}`, `/get_results/${taskId}`, `/api/v1/get_results/${taskId}`, `/api/results/${taskId}`, `/results/${taskId}`];
    }
    buildDownloadEndpoints(taskId) {
        return [`/api/download/${taskId}`, `/download/${taskId}`, `/api/v1/download/${taskId}`];
    }
    async tryRequestSequence(method, urls, configBuilder) {
        for (const u of urls) {
            try {
                const config = typeof configBuilder === 'function' ? configBuilder(u) : configBuilder;
                const resp = await this.client.request({ url: u, method, ...config });
                if (resp && resp.status >= 200 && resp.status < 300) return resp;
            } catch {}
        }
        throw new Error('all_endpoints_failed');
    }
    
    /**
     * 上传视频文件进行去水印处理
     */
    async processVideo(filePath, options = {}) {
        const startTime = Date.now();
        let attempt = 0;
        
        logger.info('开始处理视频文件', { filePath, options });
        
        while (attempt < this.retryCount) {
            try {
                attempt++;
                
                logger.info(`处理尝试 ${attempt}/${this.retryCount}`, { filePath });
                
                // 创建表单数据
                const formData = new FormData();
                
                // 添加视频文件（公开端点字段名为 video）
                const fileStream = createReadStream(filePath);
                formData.append('video', fileStream);
                
                // 进度回调（上传）
                const onUploadProgress = (progressEvent) => {
                    if (progressEvent.total && progressEvent.loaded) {
                        const progress = Math.round((progressEvent.loaded / progressEvent.total) * 100);
                        logger.debug('上传进度', { filePath, progress });
                        
                        if (options.onProgress) {
                            options.onProgress({
                                type: 'upload',
                                progress,
                                loaded: progressEvent.loaded,
                                total: progressEvent.total
                            });
                        }
                    }
                };
                
                // 提交任务到公开端点（多端点、多字段名回退）
                let submitResp;
                const fieldCandidates = ['video', 'file', 'media'];
                const endpoints = this.buildSubmitEndpoints();
                let submitted = false;
                for (const fieldName of fieldCandidates) {
                    const fd = new FormData();
                    const fileStream2 = createReadStream(filePath);
                    fd.append(fieldName, fileStream2);
                    try {
                        submitResp = await this.tryRequestSequence('post', endpoints, (u) => ({
                            url: u,
                            headers: { ...fd.getHeaders() },
                            data: fd,
                            onUploadProgress,
                            timeout: this.timeout + (options.fileSize ? Math.floor(options.fileSize / 1000000) * 10000 : 0)
                        }));
                        submitted = true;
                        break;
                    } catch {}
                }
                if (!submitted) throw new Error('submit_failed_all_endpoints');
                const taskId = submitResp.data?.task_id || submitResp.data?.taskId || submitResp.data?.data?.task_id;
                if (!taskId) {
                    throw new Error(`提交任务未返回 task_id: ${JSON.stringify(submitResp.data)}`);
                }
                logger.info('任务已提交', { filePath, taskId });
                
                // 轮询结果，直到可下载
                const pollInterval = options.pollInterval || 5000; // 默认 5s
                const pollTimeoutMs = options.pollTimeoutMs || 12 * 60 * 1000; // 默认 12 分钟上限
                const pollStart = Date.now();
                let downloadUrl = null;
                let lastStatus = null;
                
                while (!downloadUrl) {
                    if (Date.now() - pollStart > pollTimeoutMs) {
                        throw new Error(`轮询超时，任务 ${taskId} 未在预期时间完成`);
                    }
                    
                    let resultsResp;
                    try {
                        resultsResp = await this.tryRequestSequence('get', this.buildResultsEndpoints(taskId));
                    } catch (e) {
                        await this.delay(pollInterval);
                        continue;
                    }
                    const data = resultsResp.data || {};
                    logger.debug('查询结果', { taskId, data });
                    // 兼容不同字段
                    const status = data.status || data.state || data.result?.status || data?.data?.status || 'unknown';
                    const percent = typeof data.progress === 'number' ? data.progress : (typeof data?.data?.progress === 'number' ? data.data.progress : undefined);
                    lastStatus = status;
                    
                    if (options.onProgress) {
                        options.onProgress({ type: 'poll', status, progress: percent });
                    }
                    
                    // 解析可能提供的下载直链
                    const directUrl = data.download_url || data.downloadUrl || data?.data?.download_url;
                    if (directUrl) {
                        downloadUrl = directUrl;
                        break;
                    }
                    
                    // 一般完成状态为 done/completed/success/ready
                    if (/done|completed|success|ready/i.test(String(status))) {
                        downloadUrl = null; // 进入下载阶段尝试端点序列
                        break;
                    }
                    
                    await this.delay(pollInterval);
                }
                
                const processingTime = Date.now() - startTime;
                logger.info('任务可下载', { filePath, taskId, downloadUrl, processingTime, lastStatus });
                
                return {
                    success: true,
                    data: { task_id: taskId, download_url: downloadUrl },
                    processingTime,
                    attempt
                };
                
            } catch (error) {
                logger.error(`处理尝试 ${attempt} 失败`, {
                    filePath,
                    error: error.message
                });
                
                // 客户端错误不重试（保守判断 4xx）
                if (error.response?.status && error.response.status >= 400 && error.response.status < 500) {
                    return {
                        success: false,
                        error: error.response.data?.message || error.message,
                        status: error.response.status,
                        attempt
                    };
                }
                
                if (attempt >= this.retryCount) {
                    return {
                        success: false,
                        error: error.message,
                        status: error.response?.status,
                        attempt
                    };
                }
                
                await this.delay(this.retryDelay * attempt);
            }
        }
    }

    /**
     * 下载处理后的视频到指定输出路径；当 URL 以 local:// 开头时，本地复制源文件到输出
     */
    async downloadProcessedVideo(url, outputPath, options = {}) {
        try {
            if (typeof url === 'string' && url.startsWith('local://')) {
                const src = url.replace('local://', '');
                await fs.mkdir(path.dirname(outputPath), { recursive: true });
                await fs.copyFile(src, outputPath);
                if (options.onProgress) options.onProgress({ type: 'copy', progress: 100 });
                return true;
            }
            if (!url || typeof url !== 'string') {
                // 无直链时尝试一组下载端点
                const endpoints = this.buildDownloadEndpoints((options && options.taskId) || '');
                for (const u of endpoints) {
                    try {
                        const resp = await this.client.get(u, { responseType: 'arraybuffer' });
                        await fs.mkdir(path.dirname(outputPath), { recursive: true });
                        await fs.writeFile(outputPath, Buffer.from(resp.data));
                        if (options.onProgress) options.onProgress({ type: 'download', progress: 100 });
                        return true;
                    } catch {}
                }
                throw new Error('download_failed_all_endpoints');
            }
            const resp = await this.client.get(url, { responseType: 'arraybuffer' });
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, Buffer.from(resp.data));
            if (options.onProgress) options.onProgress({ type: 'download', progress: 100 });
            return true;
        } catch (e) {
            logger.error('下载视频失败', { url, error: e?.message });
            throw e;
        }
    }
    
    /**
     * 获取处理状态
     */
    async getProcessingStatus(processingId) {
        try {
            const response = await this.client.get(`/api/v1/process/${processingId}/status`);
            
            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            logger.error('获取处理状态失败', {
                processingId,
                error: error.message
            });
            
            return {
                success: false,
                error: error.message,
                status: error.response?.status
            };
        }
    }
    
    /**
     * 下载处理完成的视频
     */
    async downloadProcessedVideo(downloadUrl, outputPath, options = {}) {
        const startTime = Date.now();
        
        try {
            logger.info('开始下载处理完成的视频', { downloadUrl, outputPath });
            if (typeof downloadUrl === 'string' && downloadUrl.startsWith('local://')) {
                const src = downloadUrl.replace('local://', '');
                await fs.mkdir(path.dirname(outputPath), { recursive: true });
                await fs.copyFile(src, outputPath);
                if (options.onProgress) options.onProgress({ type: 'copy', progress: 100 });
                return {
                    success: true,
                    outputPath,
                    downloadTime: Date.now() - startTime
                };
            }

            let response;
            if (downloadUrl && typeof downloadUrl === 'string') {
                response = await this.client.get(downloadUrl, {
                    responseType: 'stream',
                    timeout: this.timeout,
                    onDownloadProgress: (progressEvent) => {
                        if (progressEvent.total && progressEvent.loaded) {
                            const progress = Math.round((progressEvent.loaded / progressEvent.total) * 100);
                            if (options.onProgress) {
                                options.onProgress({ type: 'download', progress, loaded: progressEvent.loaded, total: progressEvent.total });
                            }
                        }
                    }
                });
            } else {
                const taskId = options?.taskId || '';
                const endpoints = this.buildDownloadEndpoints(taskId);
                response = await this.tryRequestSequence('get', endpoints, { responseType: 'stream', timeout: this.timeout });
            }
            
            const fs = await import('fs/promises');
            const { createWriteStream } = await import('fs');
            
            // 确保输出目录存在
            const path = await import('path');
            const outputDir = path.dirname(outputPath);
            await fs.mkdir(outputDir, { recursive: true });
            
            // 写入文件
            const writer = createWriteStream(outputPath);
            response.data.pipe(writer);
            
            return new Promise((resolve, reject) => {
                writer.on('finish', () => {
                    const downloadTime = Date.now() - startTime;
                    logger.info('视频下载完成', { outputPath, downloadTime });
                    
                    resolve({
                        success: true,
                        outputPath,
                        downloadTime,
                        size: writer.bytesWritten
                    });
                });
                
                writer.on('error', (error) => {
                    logger.error('视频下载失败', { outputPath, error: error.message });
                    reject({ success: false, error: error.message });
                });
            });
            
        } catch (error) {
            logger.error('下载处理完成的视频失败', {
                downloadUrl,
                outputPath,
                error: error.message
            });
            
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * 批量处理多个视频文件
     */
    async processVideosBatch(filePaths, options = {}) {
        const results = [];
        const concurrency = options.concurrency || 1;
        
        logger.info('开始批量处理视频文件', { 
            count: filePaths.length, 
            concurrency 
        });
        
        // 使用p-limit控制并发
        const pLimit = await import('p-limit');
        const limit = pLimit.default(concurrency);
        
        const promises = filePaths.map((filePath, index) => 
            limit(async () => {
                try {
                    const result = await this.processVideo(filePath, {
                        ...options,
                        onProgress: (progress) => {
                            if (options.onProgress) {
                                options.onProgress({
                                    ...progress,
                                    fileIndex: index,
                                    totalFiles: filePaths.length
                                });
                            }
                        }
                    });
                    
                    results.push({
                        filePath,
                        success: result.success,
                        result,
                        index
                    });
                    
                    return result;
                } catch (error) {
                    results.push({
                        filePath,
                        success: false,
                        error: error.message,
                        index
                    });
                    
                    throw error;
                }
            })
        );
        
        await Promise.allSettled(promises);
        
        const successCount = results.filter(r => r.success).length;
        const failureCount = results.filter(r => !r.success).length;
        
        logger.info('批量处理完成', {
            total: filePaths.length,
            success: successCount,
            failure: failureCount
        });
        
        return {
            success: failureCount === 0,
            results,
            summary: {
                total: filePaths.length,
                success: successCount,
                failure: failureCount
            }
        };
    }
    
    /**
     * 延迟函数
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * 设置API密钥
     */
    setApiKey(apiKey) {
        this.apiKey = apiKey;
        logger.info('API密钥已更新');
    }
    
    /**
     * 获取客户端统计信息
     */
    getStats() {
        return {
            baseURL: this.baseURL,
            timeout: this.timeout,
            retryCount: this.retryCount,
            retryDelay: this.retryDelay,
            hasApiKey: !!this.apiKey
        };
    }
}

export default SoraApiClient;
