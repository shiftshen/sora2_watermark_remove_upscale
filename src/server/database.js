import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 数据库管理类
 * 负责处理记录和系统配置的存储管理
 */
export class DatabaseManager {
    constructor(options = {}) {
        this.dbPath = options.dbPath || join(__dirname, '../../data/database.db');
        this.db = null;
        this.initialized = false;
        
        this.init();
    }
    
    /**
     * 初始化数据库
     */
    init() {
        try {
            // 确保数据目录存在
            const dataDir = dirname(this.dbPath);
            if (!existsSync(dataDir)) {
                mkdirSync(dataDir, { recursive: true });
            }
            
            // 创建数据库连接
            this.db = new Database(this.dbPath);
            
            // 启用外键约束
            this.db.pragma('foreign_keys = ON');
            
            // 创建表结构
            this.createTables();
            
            this.initialized = true;
            
            logger.info('数据库初始化完成', { dbPath: this.dbPath });
            
        } catch (error) {
            logger.error('数据库初始化失败', { error: error.message });
            throw error;
        }
    }
    
    /**
     * 创建表结构
     */
    createTables() {
        // 文件处理记录表
        const createFileProcessingTable = `
            CREATE TABLE IF NOT EXISTS file_processing (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL,
                output_path TEXT NOT NULL,
                relative_path TEXT,
                file_size INTEGER DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'pending',
                processing_time INTEGER DEFAULT 0,
                error_message TEXT,
                attempt_count INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                started_at DATETIME,
                completed_at DATETIME,
                batch_id TEXT,
                job_id TEXT,
                api_response TEXT,
                download_url TEXT
            )
        `;
        
        // 处理日志表
        const createProcessingLogTable = `
            CREATE TABLE IF NOT EXISTS processing_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL,
                level TEXT NOT NULL,
                message TEXT NOT NULL,
                data TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (job_id) REFERENCES file_processing (job_id)
            )
        `;
        
        // 系统配置表
        const createSystemConfigTable = `
            CREATE TABLE IF NOT EXISTS system_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT UNIQUE NOT NULL,
                value TEXT NOT NULL,
                description TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;
        
        // 执行创建表语句
        this.db.exec(createFileProcessingTable);
        this.db.exec(createProcessingLogTable);
        this.db.exec(createSystemConfigTable);
        
        // 创建索引
        this.createIndexes();
        
        logger.info('数据库表结构创建完成');
    }
    
    /**
     * 创建索引
     */
    createIndexes() {
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_file_path ON file_processing(file_path)',
            'CREATE INDEX IF NOT EXISTS idx_status ON file_processing(status)',
            'CREATE INDEX IF NOT EXISTS idx_created_at ON file_processing(created_at)',
            'CREATE INDEX IF NOT EXISTS idx_batch_id ON file_processing(batch_id)',
            'CREATE INDEX IF NOT EXISTS idx_job_id ON file_processing(job_id)',
            'CREATE INDEX IF NOT EXISTS idx_log_job_id ON processing_log(job_id)',
            'CREATE INDEX IF NOT EXISTS idx_log_timestamp ON processing_log(timestamp)',
            'CREATE INDEX IF NOT EXISTS idx_config_key ON system_config(key)'
        ];
        
        indexes.forEach(index => {
            this.db.exec(index);
        });
        
        logger.info('数据库索引创建完成');
    }
    
    /**
     * 插入文件处理记录
     */
    insertFileProcessing(fileInfo) {
        try {
            const stmt = this.db.prepare(`
                INSERT INTO file_processing (
                    file_path, output_path, relative_path, file_size, status, job_id, batch_id
                ) VALUES (
                    @filePath, @outputPath, @relativePath, @fileSize, @status, @jobId, @batchId
                )
            `);
            
            const result = stmt.run({
                filePath: fileInfo.filePath,
                outputPath: fileInfo.outputPath,
                relativePath: fileInfo.relativePath || '',
                fileSize: fileInfo.fileSize || 0,
                status: fileInfo.status || 'pending',
                jobId: fileInfo.jobId,
                batchId: fileInfo.batchId || ''
            });
            
            return {
                success: true,
                id: result.lastInsertRowid,
                jobId: fileInfo.jobId
            };
            
        } catch (error) {
            logger.error('插入文件处理记录失败', { error: error.message, fileInfo });
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * 更新文件处理状态
     */
    updateFileProcessing(jobId, updates) {
        try {
            const fields = [];
            const values = {};
            
            Object.keys(updates).forEach(key => {
                const dbKey = this.camelToSnake(key);
                fields.push(`${dbKey} = @${key}`);
                values[key] = updates[key];
            });
            
            if (fields.length === 0) {
                return { success: false, error: '没有要更新的字段' };
            }
            
            fields.push('updated_at = CURRENT_TIMESTAMP');
            
            const stmt = this.db.prepare(`
                UPDATE file_processing 
                SET ${fields.join(', ')}
                WHERE job_id = @jobId
            `);
            
            values.jobId = jobId;
            
            const result = stmt.run(values);
            
            return {
                success: true,
                changes: result.changes
            };
            
        } catch (error) {
            logger.error('更新文件处理状态失败', { error: error.message, jobId, updates });
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * 获取文件处理记录
     */
    getFileProcessing(options = {}) {
        try {
            const {
                status = null,
                limit = 100,
                offset = 0,
                orderBy = 'created_at',
                orderDir = 'DESC',
                jobId = null,
                batchId = null,
                filePath = null
            } = options;
            
            let whereClause = 'WHERE 1=1';
            const params = {};
            
            if (status) {
                whereClause += ' AND status = @status';
                params.status = status;
            }
            
            if (jobId) {
                whereClause += ' AND job_id = @jobId';
                params.jobId = jobId;
            }
            
            if (batchId) {
                whereClause += ' AND batch_id = @batchId';
                params.batchId = batchId;
            }
            
            if (filePath) {
                whereClause += ' AND file_path LIKE @filePath';
                params.filePath = `%${filePath}%`;
            }
            
            const stmt = this.db.prepare(`
                SELECT * FROM file_processing
                ${whereClause}
                ORDER BY ${this.camelToSnake(orderBy)} ${orderDir}
                LIMIT @limit OFFSET @offset
            `);
            
            params.limit = limit;
            params.offset = offset;
            
            const rows = stmt.all(params);
            
            // 转换字段名
            const records = rows.map(row => this.snakeToCamel(row));
            
            // 获取总数
            const countStmt = this.db.prepare(`
                SELECT COUNT(*) as count FROM file_processing ${whereClause}
            `);
            
            const { count } = countStmt.get(params);
            
            return {
                success: true,
                records,
                total: count,
                limit,
                offset
            };
            
        } catch (error) {
            logger.error('获取文件处理记录失败', { error: error.message, options });
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * 插入处理日志
     */
    insertProcessingLog(logEntry) {
        try {
            const stmt = this.db.prepare(`
                INSERT INTO processing_log (job_id, level, message, data)
                VALUES (@jobId, @level, @message, @data)
            `);
            
            const result = stmt.run({
                jobId: logEntry.jobId,
                level: logEntry.level,
                message: logEntry.message,
                data: logEntry.data ? JSON.stringify(logEntry.data) : null
            });
            
            return {
                success: true,
                id: result.lastInsertRowid
            };
            
        } catch (error) {
            logger.error('插入处理日志失败', { error: error.message, logEntry });
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * 获取处理日志
     */
    getProcessingLog(options = {}) {
        try {
            const {
                jobId = null,
                level = null,
                limit = 1000,
                offset = 0,
                orderBy = 'timestamp',
                orderDir = 'DESC'
            } = options;
            
            let whereClause = 'WHERE 1=1';
            const params = {};
            
            if (jobId) {
                whereClause += ' AND job_id = @jobId';
                params.jobId = jobId;
            }
            
            if (level) {
                whereClause += ' AND level = @level';
                params.level = level;
            }
            
            const stmt = this.db.prepare(`
                SELECT * FROM processing_log
                ${whereClause}
                ORDER BY ${this.camelToSnake(orderBy)} ${orderDir}
                LIMIT @limit OFFSET @offset
            `);
            
            params.limit = limit;
            params.offset = offset;
            
            const rows = stmt.all(params);
            
            // 转换字段名和解析JSON数据
            const logs = rows.map(row => {
                const log = this.snakeToCamel(row);
                if (log.data) {
                    try {
                        log.data = JSON.parse(log.data);
                    } catch (e) {
                        // 保持原数据
                    }
                }
                return log;
            });
            
            return {
                success: true,
                logs,
                limit,
                offset
            };
            
        } catch (error) {
            logger.error('获取处理日志失败', { error: error.message, options });
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * 设置系统配置
     */
    setSystemConfig(key, value, description = '') {
        try {
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO system_config (key, value, description, updated_at)
                VALUES (@key, @value, @description, CURRENT_TIMESTAMP)
            `);
            
            stmt.run({
                key,
                value: typeof value === 'object' ? JSON.stringify(value) : String(value),
                description
            });
            
            return {
                success: true,
                key,
                value
            };
            
        } catch (error) {
            logger.error('设置系统配置失败', { error: error.message, key, value });
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * 获取系统配置
     */
    getSystemConfig(key = null) {
        try {
            if (key) {
                const stmt = this.db.prepare(`
                    SELECT * FROM system_config WHERE key = @key
                `);
                
                const row = stmt.get({ key });
                
                if (!row) {
                    return {
                        success: false,
                        error: '配置项不存在'
                    };
                }
                
                const config = this.snakeToCamel(row);
                
                // 尝试解析JSON值
                try {
                    config.value = JSON.parse(config.value);
                } catch (e) {
                    // 保持字符串值
                }
                
                return {
                    success: true,
                    config
                };
                
            } else {
                const stmt = this.db.prepare(`
                    SELECT * FROM system_config ORDER BY key
                `);
                
                const rows = stmt.all();
                
                const configs = rows.map(row => {
                    const config = this.snakeToCamel(row);
                    
                    // 尝试解析JSON值
                    try {
                        config.value = JSON.parse(config.value);
                    } catch (e) {
                        // 保持字符串值
                    }
                    
                    return config;
                });
                
                return {
                    success: true,
                    configs
                };
            }
            
        } catch (error) {
            logger.error('获取系统配置失败', { error: error.message, key });
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * 获取统计信息
     */
    getStats() {
        try {
            const stats = {};
            
            // 文件处理统计
            const fileStatsStmt = this.db.prepare(`
                SELECT 
                    status,
                    COUNT(*) as count,
                    SUM(file_size) as total_size,
                    AVG(processing_time) as avg_time
                FROM file_processing
                GROUP BY status
            `);
            
            const fileStats = fileStatsStmt.all();
            stats.fileProcessing = {};
            
            fileStats.forEach(stat => {
                stats.fileProcessing[stat.status] = {
                    count: stat.count,
                    totalSize: stat.total_size || 0,
                    avgTime: stat.avg_time || 0
                };
            });
            
            // 总体统计
            const totalStmt = this.db.prepare(`
                SELECT COUNT(*) as total, 
                       COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                       COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
                       COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending
                FROM file_processing
            `);
            
            const totalStats = totalStmt.get();
            stats.total = {
                total: totalStats.total,
                completed: totalStats.completed,
                failed: totalStats.failed,
                pending: totalStats.pending
            };
            
            return {
                success: true,
                stats
            };
            
        } catch (error) {
            logger.error('获取统计信息失败', { error: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * 清理过期数据
     */
    cleanup(olderThanDays = 30) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
            
            // 清理旧的文件处理记录
            const deleteFilesStmt = this.db.prepare(`
                DELETE FROM file_processing 
                WHERE created_at < @cutoffDate 
                AND status IN ('completed', 'failed')
            `);
            
            const fileResult = deleteFilesStmt.run({
                cutoffDate: cutoffDate.toISOString()
            });
            
            // 清理旧的日志记录
            const deleteLogsStmt = this.db.prepare(`
                DELETE FROM processing_log 
                WHERE timestamp < @cutoffDate
            `);
            
            const logResult = deleteLogsStmt.run({
                cutoffDate: cutoffDate.toISOString()
            });
            
            logger.info('数据清理完成', {
                olderThanDays,
                deletedFiles: fileResult.changes,
                deletedLogs: logResult.changes
            });
            
            return {
                success: true,
                deletedFiles: fileResult.changes,
                deletedLogs: logResult.changes
            };
            
        } catch (error) {
            logger.error('数据清理失败', { error: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * 关闭数据库连接
     */
    close() {
        try {
            if (this.db) {
                this.db.close();
                logger.info('数据库连接已关闭');
            }
        } catch (error) {
            logger.error('关闭数据库连接失败', { error: error.message });
        }
    }
    
    /**
     * 驼峰命名转下划线命名
     */
    camelToSnake(str) {
        return str.replace(/([A-Z])/g, '_$1').toLowerCase();
    }
    
    /**
     * 下划线命名转驼峰命名
     */
    snakeToCamel(obj) {
        const result = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
                result[camelKey] = obj[key];
            }
        }
        return result;
    }
}

// 创建全局数据库实例
export const db = new DatabaseManager({
    dbPath: process.env.DB_PATH || join(process.cwd(), 'data', 'database.db')
});

export default db;