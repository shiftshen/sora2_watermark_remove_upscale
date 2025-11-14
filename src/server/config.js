import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const path = require('path');

/**
 * 配置管理器
 * 负责加载和管理应用程序配置
 */
export class ConfigManager {
    constructor(options = {}) {
        this.configPath = options.configPath || join(process.cwd(), 'config.json');
        this.env = options.env || process.env.NODE_ENV || 'development';
        this.config = {};
        
        this.loadConfig();
    }
    
    /**
     * 加载配置
     */
    loadConfig() {
        // 默认配置
        const defaultConfig = {
            // 目录配置
            directories: {
                input: join(process.cwd(), 'Input'),
                output: join(process.cwd(), 'Output'),
                data: join(process.cwd(), 'data'),
                logs: join(process.cwd(), 'logs')
            },
            
            // API配置
            api: {
                baseUrl: 'https://sora.xmanx.com',
                timeout: 300000, // 5分钟
                retryCount: 3,
                retryDelay: 5000,
                maxFileSize: 500 * 1024 * 1024, // 500MB
                supportedFormats: ['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm']
            },
            
            // 文件监控配置
            fileMonitor: {
                debounceMs: 2000,
                recursive: true,
                persistent: true,
                ignoreInitial: false,
                followSymlinks: false,
                ignorePermissionErrors: true
            },
            
            // 批处理配置
            batchProcessor: {
                batchSize: 5,
                concurrentLimit: 3,
                retryCount: 3,
                retryDelay: 5000,
                autoStart: true
            },
            
            // 日志配置
            logging: {
                level: 'INFO',
                enableConsole: true,
                enableFile: true,
                enableColors: true,
                maxFileSize: 10 * 1024 * 1024, // 10MB
                maxFiles: 10
            },
            
            // 数据库配置
            database: {
                path: join(process.cwd(), 'data', 'database.db'),
                backupEnabled: true,
                backupInterval: 24 * 60 * 60 * 1000, // 24小时
                cleanupOlderThanDays: 30
            },
            
            // 系统配置
            system: {
                checkInterval: 5000, // 5秒
                healthCheckInterval: 60000, // 1分钟
                maxProcessingTime: 3600000, // 1小时
                shutdownTimeout: 30000, // 30秒
                enableMetrics: true
            },
            
            // 开发环境特定配置
            development: {
                logging: {
                    level: 'DEBUG',
                    enableConsole: true,
                    enableColors: true
                },
                fileMonitor: {
                    debounceMs: 1000
                }
            },
            
            // 生产环境特定配置
            production: {
                logging: {
                    level: 'INFO',
                    enableConsole: false,
                    enableColors: false
                },
                fileMonitor: {
                    debounceMs: 3000
                },
                batchProcessor: {
                    batchSize: 10,
                    concurrentLimit: 5
                }
            }
        };
        
        // 从配置文件加载
        let fileConfig = {};
        if (existsSync(this.configPath)) {
            try {
                const configContent = readFileSync(this.configPath, 'utf8');
                fileConfig = JSON.parse(configContent);
                console.log(`从配置文件加载配置: ${this.configPath}`);
            } catch (error) {
                console.error('加载配置文件失败:', error.message);
            }
        }
        
        // 合并配置
        this.config = this.deepMerge(defaultConfig, fileConfig);
        
        // 应用环境特定配置
        if (this.config[this.env]) {
            this.config = this.deepMerge(this.config, this.config[this.env]);
        }
        
        // 从环境变量加载配置
        this.loadFromEnvironment();
        
        // 验证配置
        this.validateConfig();
        
        console.log(`配置加载完成，环境: ${this.env}`);
    }
    
    /**
     * 从环境变量加载配置
     */
    loadFromEnvironment() {
        const envMappings = {
            // 目录配置
            'SORA_INPUT_DIR': 'directories.input',
            'SORA_OUTPUT_DIR': 'directories.output',
            'SORA_DATA_DIR': 'directories.data',
            'SORA_LOG_DIR': 'directories.logs',
            
            // API配置
            'SORA_API_BASE_URL': 'api.baseUrl',
            'SORA_API_TIMEOUT': 'api.timeout',
            'SORA_API_RETRY_COUNT': 'api.retryCount',
            'SORA_API_RETRY_DELAY': 'api.retryDelay',
            'SORA_API_MAX_FILE_SIZE': 'api.maxFileSize',
            
            // 批处理配置
            'SORA_BATCH_SIZE': 'batchProcessor.batchSize',
            'SORA_CONCURRENT_LIMIT': 'batchProcessor.concurrentLimit',
            
            // 日志配置
            'SORA_LOG_LEVEL': 'logging.level',
            'SORA_LOG_ENABLE_CONSOLE': 'logging.enableConsole',
            'SORA_LOG_ENABLE_FILE': 'logging.enableFile',
            'SORA_LOG_ENABLE_COLORS': 'logging.enableColors',
            
            // 文件监控配置
            'SORA_WATCH_DEBOUNCE_MS': 'fileMonitor.debounceMs',
            'SORA_MAX_FILE_SIZE': 'api.maxFileSize',
            
            // 数据库配置
            'SORA_DB_PATH': 'database.path',
            
            // 系统配置
            'NODE_ENV': null, // 已在构造函数中处理
        };
        
        for (const [envKey, configPath] of Object.entries(envMappings)) {
            const envValue = process.env[envKey];
            if (envValue !== undefined && configPath) {
                this.setConfigValue(configPath, this.parseEnvValue(envValue));
            }
        }
    }
    
    /**
     * 解析环境变量值
     */
    parseEnvValue(value) {
        // 布尔值
        if (value === 'true') return true;
        if (value === 'false') return false;
        
        // 数字
        if (/^\d+$/.test(value)) {
            return parseInt(value, 10);
        }
        
        // 浮点数
        if (/^\d*\.\d+$/.test(value)) {
            return parseFloat(value);
        }
        
        // JSON
        if ((value.startsWith('{') && value.endsWith('}')) || 
            (value.startsWith('[') && value.endsWith(']'))) {
            try {
                return JSON.parse(value);
            } catch (e) {
                // 保持字符串
            }
        }
        
        // 字符串
        return value;
    }
    
    /**
     * 深度合并对象
     */
    deepMerge(target, source) {
        const result = { ...target };
        
        for (const key in source) {
            if (source.hasOwnProperty(key)) {
                if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
                    result[key] = this.deepMerge(target[key] || {}, source[key]);
                } else {
                    result[key] = source[key];
                }
            }
        }
        
        return result;
    }
    
    /**
     * 设置配置值
     */
    setConfigValue(path, value) {
        const keys = path.split('.');
        let current = this.config;
        
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (!current[key] || typeof current[key] !== 'object') {
                current[key] = {};
            }
            current = current[key];
        }
        
        current[keys[keys.length - 1]] = value;
    }
    
    /**
     * 获取配置值
     */
    get(path, defaultValue = null) {
        if (!path) {
            return this.config;
        }
        
        const keys = path.split('.');
        let current = this.config;
        
        for (const key of keys) {
            if (current && typeof current === 'object' && key in current) {
                current = current[key];
            } else {
                return defaultValue;
            }
        }
        
        return current;
    }
    
    /**
     * 验证配置
     */
    validateConfig() {
        const errors = [];
        
        // 验证必需的路径
        const requiredPaths = [
            'directories.input',
            'directories.output',
            'directories.data',
            'directories.logs'
        ];
        
        for (const path of requiredPaths) {
            const value = this.get(path);
            if (!value || typeof value !== 'string') {
                errors.push(`配置路径无效: ${path}`);
            }
        }
        
        // 验证API配置
        const apiUrl = this.get('api.baseUrl');
        if (!apiUrl || !apiUrl.startsWith('http')) {
            errors.push('API基础URL格式无效');
        }
        
        // 验证批处理配置
        const batchSize = this.get('batchProcessor.batchSize');
        if (!batchSize || batchSize < 1 || batchSize > 100) {
            errors.push('批处理大小必须在1-100之间');
        }
        
        const concurrentLimit = this.get('batchProcessor.concurrentLimit');
        if (!concurrentLimit || concurrentLimit < 1 || concurrentLimit > 20) {
            errors.push('并发限制必须在1-20之间');
        }
        
        // 验证日志级别
        const validLogLevels = ['ERROR', 'WARNING', 'INFO', 'DEBUG', 'TRACE'];
        const logLevel = this.get('logging.level');
        if (!validLogLevels.includes(logLevel)) {
            errors.push(`无效的日志级别: ${logLevel}`);
        }
        
        if (errors.length > 0) {
            throw new Error(`配置验证失败:\n${errors.join('\n')}`);
        }
    }
    
    /**
     * 保存配置到文件
     */
    saveToFile(filePath = null) {
        try {
            const targetPath = filePath || this.configPath;
            const { writeFileSync } = require('fs');
            
            // 移除环境特定配置
            const configToSave = { ...this.config };
            delete configToSave.development;
            delete configToSave.production;
            
            writeFileSync(targetPath, JSON.stringify(configToSave, null, 2));
            
            console.log(`配置已保存到: ${targetPath}`);
            return true;
            
        } catch (error) {
            console.error('保存配置失败:', error.message);
            return false;
        }
    }
    
    /**
     * 获取配置摘要
     */
    getSummary() {
        return {
            environment: this.env,
            configPath: this.configPath,
            directories: this.get('directories'),
            api: {
                baseUrl: this.get('api.baseUrl'),
                timeout: this.get('api.timeout'),
                maxFileSize: this.get('api.maxFileSize')
            },
            batchProcessor: this.get('batchProcessor'),
            logging: this.get('logging'),
            system: this.get('system')
        };
    }
}

// 创建全局配置实例
export const config = new ConfigManager({
    env: process.env.NODE_ENV || 'development'
});

export default config;