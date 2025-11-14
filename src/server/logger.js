import { createWriteStream, existsSync, mkdirSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import { createLogger, format, transports } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 日志级别定义
 */
const LOG_LEVELS = {
    ERROR: 0,
    WARNING: 1,
    INFO: 2,
    DEBUG: 3,
    TRACE: 4
};

/**
 * 日志级别名称映射
 */
const LEVEL_NAMES = Object.keys(LOG_LEVELS);

/**
 * 日志系统类
 * 提供结构化日志记录、文件输出和级别控制功能
 */
export class Logger {
    constructor(options = {}) {
        this.level = options.level || 'INFO';
        this.levelValue = LOG_LEVELS[this.level] ?? LOG_LEVELS.INFO;
        this.enableConsole = options.enableConsole !== false;
        this.enableFile = options.enableFile !== false;
        this.logDir = options.logDir || join(__dirname, '../../logs');
        this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
        this.maxFiles = options.maxFiles || 10;
        this.enableColors = options.enableColors !== false;
        
        this.logStreams = new Map();
        this.startTime = Date.now();
        this.processId = process.pid;
        
        this.init();
    }
    
    /**
     * 初始化日志系统
     */
    init() {
        if (this.enableFile) {
            // 确保日志目录存在
            if (!existsSync(this.logDir)) {
                mkdirSync(this.logDir, { recursive: true });
            }
            
            // 创建主要日志流
            this.createLogStream('main');
            this.createLogStream('error');
        }
        
        // 使用实例方法，避免在初始化期间引用尚未赋值的全局 logger
        this.info('日志系统初始化完成', {
            level: this.level,
            enableConsole: this.enableConsole,
            enableFile: this.enableFile,
            logDir: this.logDir
        });
    }
    
    /**
     * 创建日志文件流
     */
    createLogStream(type) {
        const logFile = join(this.logDir, `${type}.log`);
        const stream = createWriteStream(logFile, { flags: 'a' });
        
        this.logStreams.set(type, {
            stream,
            file: logFile,
            size: 0,
            createdAt: new Date()
        });
        
        return stream;
    }
    
    /**
     * 获取日志文件路径
     */
    getLogFile(type = 'main') {
        return join(this.logDir, `${type}.log`);
    }
    
    /**
     * 写入日志文件
     */
    writeToFile(type, message) {
        if (!this.enableFile) return;
        
        const logStream = this.logStreams.get(type);
        if (!logStream) {
            this.createLogStream(type);
        }
        
        try {
            const stream = this.logStreams.get(type).stream;
            stream.write(message + '\n');
            
            // 更新文件大小
            this.logStreams.get(type).size += Buffer.byteLength(message + '\n');
            
            // 检查是否需要轮转
            if (this.logStreams.get(type).size > this.maxFileSize) {
                this.rotateLogFile(type);
            }
            
        } catch (error) {
            console.error('写入日志文件失败:', error);
        }
    }
    
    /**
     * 轮转日志文件
     */
    rotateLogFile(type) {
        try {
            const logStream = this.logStreams.get(type);
            if (!logStream) return;
            
            // 关闭当前流
            logStream.stream.end();
            
            // 重命名旧文件
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const oldFile = `${logStream.file}.${timestamp}`;
            
            const { readdirSync, statSync, unlinkSync, appendFileSync, readFileSync } = require('fs');
            renameSync(logStream.file, oldFile);
            
            // 创建新流
            this.createLogStream(type);
            
            logger.info('日志文件轮转完成', {
                type,
                oldFile,
                newFile: logStream.file
            });
            
        } catch (error) {
            console.error('日志文件轮转失败:', error);
        }
    }
    
    /**
     * 格式化日志消息
     */
    formatMessage(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const levelName = LEVEL_NAMES[LOG_LEVELS[level]] || 'UNKNOWN';
        
        const logEntry = {
            timestamp,
            level: levelName,
            processId: this.processId,
            message,
            data: data || undefined,
            uptime: Date.now() - this.startTime
        };
        
        return JSON.stringify(logEntry);
    }
    
    /**
     * 控制台输出格式化
     */
    formatConsoleMessage(level, message, data = null) {
        const timestamp = new Date().toLocaleString();
        const levelName = LEVEL_NAMES[LOG_LEVELS[level]] || 'UNKNOWN';
        
        let color = '';
        let reset = '';
        
        if (this.enableColors) {
            const colors = {
                ERROR: '\x1b[31m',    // 红色
                WARNING: '\x1b[33m', // 黄色
                INFO: '\x1b[36m',    // 青色
                DEBUG: '\x1b[35m',   // 紫色
                TRACE: '\x1b[90m'    // 灰色
            };
            
            color = colors[level] || '';
            reset = '\x1b[0m';
        }
        
        let output = `${color}[${timestamp}] [${levelName}] ${message}${reset}`;
        
        if (data) {
            output += `\n${color}${JSON.stringify(data, null, 2)}${reset}`;
        }
        
        return output;
    }
    
    /**
     * 记录日志
     */
    log(level, message, data = null) {
        const levelValue = LOG_LEVELS[level];
        
        if (levelValue > this.levelValue) {
            return;
        }
        
        // 格式化日志消息
        const formattedMessage = this.formatMessage(level, message, data);
        
        // 写入文件
        this.writeToFile('main', formattedMessage);
        
        // 错误级别额外写入错误日志
        if (level === 'ERROR') {
            this.writeToFile('error', formattedMessage);
        }
        
        // 控制台输出
        if (this.enableConsole) {
            const consoleMessage = this.formatConsoleMessage(level, message, data);
            
            if (level === 'ERROR') {
                console.error(consoleMessage);
            } else if (level === 'WARNING') {
                console.warn(consoleMessage);
            } else {
                console.log(consoleMessage);
            }
        }
    }
    
    /**
     * 错误级别日志
     */
    error(message, data = null) {
        this.log('ERROR', message, data);
    }
    
    /**
     * 警告级别日志
     */
    warning(message, data = null) {
        this.log('WARNING', message, data);
    }
    
    /**
     * 信息级别日志
     */
    info(message, data = null) {
        this.log('INFO', message, data);
    }
    
    /**
     * 调试级别日志
     */
    debug(message, data = null) {
        this.log('DEBUG', message, data);
    }
    
    /**
     * 跟踪级别日志
     */
    trace(message, data = null) {
        this.log('TRACE', message, data);
    }
    
    /**
     * 设置日志级别
     */
    setLevel(level) {
        const newLevel = level.toUpperCase();
        if (LOG_LEVELS.hasOwnProperty(newLevel)) {
            this.level = newLevel;
            this.levelValue = LOG_LEVELS[newLevel];
            this.info('日志级别已更新', { newLevel });
        } else {
            this.error('无效的日志级别', { level });
        }
    }
    
    /**
     * 关闭日志系统
     */
    async close() {
        this.info('正在关闭日志系统...');
        
        // 关闭所有日志流
        for (const [type, logStream] of this.logStreams) {
            try {
                logStream.stream.end();
                this.info(`日志流已关闭: ${type}`);
            } catch (error) {
                console.error(`关闭日志流失败: ${type}`, error);
            }
        }
        
        this.logStreams.clear();
        this.info('日志系统已关闭');
    }
    
    /**
     * 获取日志统计信息
     */
    getStats() {
        return {
            level: this.level,
            enableConsole: this.enableConsole,
            enableFile: this.enableFile,
            logDir: this.logDir,
            activeStreams: this.logStreams.size,
            uptime: Date.now() - this.startTime,
            processId: this.processId
        };
    }
}

// 创建全局日志实例
export const logger = new Logger({
    level: process.env.LOG_LEVEL || 'INFO',
    enableConsole: process.env.NODE_ENV !== 'production',
    enableFile: true,
    logDir: process.env.LOG_DIR || join(process.cwd(), 'logs'),
    enableColors: process.env.NODE_ENV !== 'production'
});

export default logger;