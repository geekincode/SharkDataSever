const aedes = require('aedes')();
const net = require('net');
const protobuf = require('protobufjs');
const fs = require('fs');
const path = require('path');

class MQTTServer {
    constructor(port = 3333, host = '127.0.0.1') {
        this.port = port;
        this.host = host;
        this.server = null;
        this.protoRoot = null;
        this.publishInterval = null;
        this.messageCount = 0;

        // 模拟数据计数器
        this.simulationCounters = {
            gameRound: 1,
            frameNumber: 0,
            robotHealth: 600,
            baseHealth: 5000
        };
    // 使用消息名作为主题 (例如: 'GameStatus')，不要使用前缀
    this.serverTopicPrefix = '';
    this.clientTopicPrefix = '';
    this.serverMessageNames = [];
    this.clientMessageNames = [];

    // 存储客户端上传的数据
    this.clientDataStore = {};
    }

    async loadProto() {
        try {
            const protoPath = path.join(__dirname, '..', 'proto', 'messages.proto');
            const protoText = fs.readFileSync(protoPath, 'utf8');
            const lines = protoText.split(/\r?\n/);

            const upIndex = lines.findIndex(l => /^\s*package\s+rm_client_up\s*;/.test(l));
            const downIndex = lines.findIndex(l => /^\s*package\s+rm_client_down\s*;/.test(l));

            const upProto = ['syntax = "proto3";', 'package rm_client_up;', ...lines.slice(upIndex + 1, downIndex)].join('\n');
            const downProto = ['syntax = "proto3";', 'package rm_client_down;', ...lines.slice(downIndex + 1)].join('\n');

            const upParsed = protobuf.parse(upProto);
            const downParsed = protobuf.parse(downProto);

            this.protoRoot = new protobuf.Root();
            this.protoRoot.nested = {};
            if (upParsed.root.nested.rm_client_up) {
                this.protoRoot.nested.rm_client_up = upParsed.root.nested.rm_client_up;
                this.protoRoot.nested.rm_client_up.parent = this.protoRoot;
            }
            if (downParsed.root.nested.rm_client_down) {
                this.protoRoot.nested.rm_client_down = downParsed.root.nested.rm_client_down;
                this.protoRoot.nested.rm_client_down.parent = this.protoRoot;
            }
            const foundServer = new Set();
            const foundClient = new Set();

            // 查找 package 的位置 (上行/下行)
            const upIndex = lines.findIndex(l => /^\s*package\s+rm_client_up\s*;/.test(l));
            const downIndex = lines.findIndex(l => /^\s*package\s+rm_client_down\s*;/.test(l));

            // 收集上行消息 (Client -> Server)
            if (upIndex !== -1) {
                const endIdx = downIndex !== -1 ? downIndex : lines.length;
                for (let i = upIndex + 1; i < endIdx; i++) {
                    const mm = lines[i].match(/^\s*message\s+([A-Za-z0-9_]+)\s*\{/);
                    if (mm) foundClient.add(mm[1]);
                }
            }

            // 收集下行消息 (Server -> Client)
            if (downIndex !== -1) {
                for (let i = downIndex + 1; i < lines.length; i++) {
                    const mm = lines[i].match(/^\s*message\s+([A-Za-z0-9_]+)\s*\{/);
                    if (mm) foundServer.add(mm[1]);
                }
            }

            this.serverMessageNames = Array.from(foundServer).sort();
            this.clientMessageNames = Array.from(foundClient).sort();
            console.log('🔍 解析到 Server->Client 消息:', this.serverMessageNames.join(', '));
            console.log('🔍 解析到 Client->Server 消息:', this.clientMessageNames.join(', '));
            console.log('✅ Protobuf 定义加载成功');
            return true;
        } catch (error) {
            console.error('❌ Protobuf 加载失败:', error.message);
            return false;
        }
    }

    async start() {
        // 加载 Protobuf 定义
        const loaded = await this.loadProto();
        if (!loaded) {
            throw new Error('Protobuf 加载失败，无法启动 MQTT 服务');
        }

        return new Promise((resolve, reject) => {
            // 创建 TCP 服务器用于 MQTT
            this.server = net.createServer(aedes.handle);

            this.server.on('error', (err) => {
                console.error(`❌ MQTT 服务器错误: ${err.message}`);
                reject(err);
            });

            // 监听客户端连接
            aedes.on('client', (client) => {
                console.log(`📱 MQTT 客户端已连接: ${client.id}`);
                
                // 客户端连接后开始定时发送数据
                if (!this.publishInterval) {
                    this.startPublishing();
                }
            });

            // 监听客户端断开
            aedes.on('clientDisconnect', (client) => {
                console.log(`📴 MQTT 客户端已断开: ${client.id}`);
            });

            // 监听订阅事件
            aedes.on('subscribe', (subscriptions, client) => {
                console.log(`📌 客户端 ${client.id} 订阅了主题:`, subscriptions.map(s => s.topic).join(', '));
            });

            // 兼容旧版主题映射（保留，可选）
            const clientTopicMap = {
                // 高频键鼠输入
                'robot/client/remote': { msg: 'RemoteControl', sampleRate: 10 }, // 默认采样：每10帧记录一次
                '555': { msg: 'RemoteControl', sampleRate: 10 },
                // 地图点击
                'robot/client/mapclick': { msg: 'MapClickInfoNotify', sampleRate: 1 },
                '111111': { msg: 'MapClickInfoNotify', sampleRate: 1 },
                // 工程装配
                'robot/client/assembly': { msg: 'AssemblyCommand', sampleRate: 1 },
                'robot/client/performance': { msg: 'RobotPerformanceSelectionCommand', sampleRate: 1 },
                'robot/client/hero_deploy': { msg: 'HeroDeployModeEventCommand', sampleRate: 1 },
                'robot/client/rune_activate': { msg: 'RuneActivateCommand', sampleRate: 1 },
                'robot/client/dart': { msg: 'DartCommand', sampleRate: 1 },
                'robot/client/guardctrl': { msg: 'GuardCtrlCommand', sampleRate: 1 },
                'robot/client/airsupport': { msg: 'AirSupportCommand', sampleRate: 1 },
            };

            // 采样计数器
            const samplingCounters = {};

            // 监听所有发布事件，解析客户端发来的消息
            aedes.on('publish', async (packet, client) => {
                try {
                    // 只处理来自客户端的消息（而非 Broker 自己发布）
                    if (!client) return;

                    const topic = packet.topic;
                    // 优先使用客户端主题前缀解析 (client/<MessageName>)
                    let mapping = clientTopicMap[topic];
                    let MessageType = null;
                    if (!mapping) {
                        // 处理直接以消息名作为 topic 的情况，例如 'RemoteControl'
                        const name = topic;
                        if (name && this.clientMessageNames.includes(name)) {
                            MessageType = this.protoRoot.lookupType(`rm_client_up.${name}`);
                            mapping = { msg: name, sampleRate: 1 };
                        }
                    } else {
                        MessageType = this.protoRoot.lookupType(`rm_client_up.${mapping.msg}`);
                    }

                    if (!MessageType || !mapping) return; // 对于没有映射的主题不处理

                    samplingCounters[topic] = (samplingCounters[topic] || 0) + 1;
                    const shouldLog = (samplingCounters[topic] % (mapping.sampleRate || 1) === 0);
                    let decoded = null;
                    try {
                        decoded = MessageType.decode(packet.payload);
                    } catch (err) {
                        // 防止单条消息解析错误导致服务崩溃
                        if (shouldLog) console.error(`❌ 解析 ${topic} 的 Protobuf 失败:`, err.message);
                        return;
                    }

                    const obj = MessageType.toObject(decoded, { longs: String, enums: String, bytes: Buffer, keepCase: true });

                    // 存储客户端数据
                    if (!this.clientDataStore[client.id]) {
                        this.clientDataStore[client.id] = {};
                    }
                    this.clientDataStore[client.id][mapping.msg] = {
                        data: obj,
                        timestamp: Date.now(),
                        topic: topic
                    };

                    if (shouldLog) {
                        console.log(`📥 收到客户端消息 - 客户端: ${client.id}, 主题: ${topic}, 类型: ${mapping.msg}`);
                        console.log('   内容:', JSON.stringify(obj));
                    }
                } catch (err) {
                    console.error('❌ 处理客户端发布消息时发生错误:', err.message);
                }
            });

            // 启动服务器
            this.server.listen(this.port, this.host, () => {
                console.log(`✅ MQTT 服务已启动`);
                console.log(`   - 端口: ${this.port}`);
                console.log(`   - 地址: mqtt://${this.host}:${this.port}`);
                console.log(`   - 发布主题: 使用消息名作为 Topic（例如: GameStatus, RemoteControl 等）`);
                console.log(`   - 发布频率: 每3秒一次`);
                resolve();
            });
        });
    }

    startPublishing() {
        console.log('🚀 开始定时发布机器人数据...');
        this.publishInterval = setInterval(() => {
            this.publishRobotData();
        }, 3000); // 每3秒发布一次
    }

    generateMockRobotData() {
        // 更新模拟数据
        this.simulationCounters.frameNumber++;
        this.simulationCounters.robotHealth = Math.max(0, this.simulationCounters.robotHealth - Math.floor(Math.random() * 50));
        this.simulationCounters.baseHealth = Math.max(0, this.simulationCounters.baseHealth - Math.floor(Math.random() * 100));

        // 如果血量为0，重置
        if (this.simulationCounters.robotHealth === 0) {
            this.simulationCounters.robotHealth = 600;
        }
        if (this.simulationCounters.baseHealth === 0) {
            this.simulationCounters.baseHealth = 5000;
        }

        // 创建多个消息类型的模拟数据
        const mockData = {
            // 游戏状态
            gameStatus: {
                current_round: this.simulationCounters.gameRound,
                total_rounds: 3,
                red_score: Math.floor(Math.random() * 100),
                blue_score: Math.floor(Math.random() * 100),
                current_stage: 4, // 比赛中
                stage_countdown_sec: 420 - (this.messageCount * 3) % 420,
                stage_elapsed_sec: (this.messageCount * 3) % 420,
                is_paused: false
            },
            
            // 机器人动态状态
            robotDynamicStatus: {
                current_health: this.simulationCounters.robotHealth,
                current_heat: Math.random() * 100,
                last_projectile_fire_rate: 15 + Math.random() * 3,
                current_chassis_energy: Math.floor(Math.random() * 60),
                current_buffer_energy: Math.floor(Math.random() * 100),
                current_experience: Math.floor(Math.random() * 500),
                experience_for_upgrade: 1000,
                total_projectiles_fired: Math.floor(this.messageCount * 2.5),
                remaining_ammo: Math.max(0, 200 - this.messageCount),
                is_out_of_combat: Math.random() > 0.5,
                out_of_combat_countdown: Math.floor(Math.random() * 10),
                can_remote_heal: true,
                can_remote_ammo: true
            },

            // 机器人位置
            robotPosition: {
                x: Math.random() * 28 - 14,
                y: Math.random() * 15 - 7.5,
                z: 0.5,
                yaw: Math.random() * 360
            },

            // 全局单位状态
            globalUnitStatus: {
                base_health: this.simulationCounters.baseHealth,
                base_status: 1,
                base_shield: Math.floor(Math.random() * 500),
                outpost_health: Math.floor(Math.random() * 1500),
                outpost_status: 1,
                robot_health: [600, 500, 400, 300, 200, 600, 500, 400, 300, 200],
                robot_bullets: [200, 180, 150, 120, 100],
                total_damage_red: Math.floor(Math.random() * 5000),
                total_damage_blue: Math.floor(Math.random() * 5000)
            }
        };

        return mockData;
    }

    publishRobotData() {
        try {
            const mockData = this.generateMockRobotData();
            this.messageCount++;

            // 根据 proto 自动发布到不同的主题 (robot/<MessageName>)
            // 只发布属于 server->client 的消息
            const validServerMsgs = this.serverMessageNames.filter(n => mockData.hasOwnProperty(this.toCamelCase(n)));
            const messageTypes = validServerMsgs.length > 0 ? validServerMsgs : Object.keys(mockData).map(k => this.getProtoMessageName(k));
            const selectedType = messageTypes[this.messageCount % messageTypes.length];
            const selectedData = mockData[this.toCamelCase(selectedType)] || mockData[selectedType] || mockData[this.fromProtoName(selectedType)];

            // 获取消息类型定义
            const MessageType = this.protoRoot.lookupType(`rm_client_down.${selectedType}`);
            
            // 将 snake_case 键名转换为 camelCase，以适配 protobufjs 的字段名
            const normalizedData = this.convertKeysToCamel(selectedData);

            // 验证数据
            const errMsg = MessageType.verify(normalizedData);
            if (errMsg) {
                console.error(`❌ 数据验证失败 (${selectedType}):`, errMsg);
                return;
            }

            // 创建消息
            const message = MessageType.create(normalizedData);
            
            // 编码为 Protobuf 二进制
            const buffer = MessageType.encode(message).finish();

            // 发布到 MQTT（每种消息为单独主题： robot/<MessageName>）
            const topicName = `${this.serverTopicPrefix}${selectedType}`;
            aedes.publish({
                topic: topicName,
                payload: buffer,
                qos: 0,
                retain: false
            }, (err) => {
                if (err) {
                    console.error(`❌ MQTT 发布失败:`, err.message);
                } else {
                    if (buffer.length === 0) {
                        console.warn(`⚠️ 编码后的 Buffer 长度为 0 - 类型: ${selectedType}`);
                        try {
                            console.warn('   MessageType fields:', Object.keys(MessageType.fields));
                        } catch (e) { }
                        try {
                            console.warn('   验证返回 errMsg:', errMsg || '无');
                        } catch (e) { }
                        try {
                            console.warn('   发送数据样例:', JSON.stringify(selectedData).substring(0, 300));
                        } catch (e) { }
                    }
                    console.log(`📨 MQTT 发送 [${this.messageCount}] - 主题: ${topicName}, 类型: ${selectedType}, 大小: ${buffer.length} 字节`);
                    console.log(`   数据预览:`, JSON.stringify(selectedData).substring(0, 100) + '...');
                }
            });

        } catch (error) {
            console.error('❌ 发布数据时出错:', error.message);
        }
    }

    getProtoMessageName(jsName) {
        // 将 JavaScript 驼峰命名转换为 Proto 消息名
        const nameMap = {
            'gameStatus': 'GameStatus',
            'robotDynamicStatus': 'RobotDynamicStatus',
            'robotPosition': 'RobotPosition',
            'globalUnitStatus': 'GlobalUnitStatus'
        };
        return nameMap[jsName] || jsName;
    }

    // 将 Proto 消息名转换为小驼峰的 js key（尽可能合理尝试）
    toCamelCase(protoName) {
        if (!protoName) return protoName;
        return protoName.charAt(0).toLowerCase() + protoName.slice(1);
    }

    // 从 Proto 消息名尝试还原 JS 字段名（按本项目中常见的命名）
    fromProtoName(protoName) {
        return this.toCamelCase(protoName);
    }

    // 将 data 中 snake_case 的键全部转换成 camelCase，递归处理对象和数组
    convertKeysToCamel(value) {
        if (Array.isArray(value)) {
            return value.map(v => this.convertKeysToCamel(v));
        }
        if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
            const newObj = {};
            for (const [k, v] of Object.entries(value)) {
                const camelKey = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
                newObj[camelKey] = this.convertKeysToCamel(v);
            }
            return newObj;
        }
        return value;
    }

    getClientData(clientId, messageType) {
        if (clientId && messageType) {
            return this.clientDataStore[clientId]?.[messageType];
        }
        if (clientId) {
            return this.clientDataStore[clientId];
        }
        return this.clientDataStore;
    }

    stop() {
        if (this.publishInterval) {
            clearInterval(this.publishInterval);
            this.publishInterval = null;
            console.log('⏹️  停止发布数据');
        }

        if (this.server) {
            this.server.close(() => {
                console.log('⏹️  MQTT 服务已停止');
            });
        }

        if (aedes) {
            aedes.close(() => {
                console.log('⏹️  MQTT Broker 已关闭');
            });
        }
    }
}

module.exports = MQTTServer;

// 如果直接运行此文件，则启动 MQTT 服务（便于单独测试）
if (require.main === module) {
    (async () => {
        const s = new MQTTServer();
        try {
            await s.start();
            console.log('✅ MQTT Server 已单独启动（用于测试）');
        } catch (err) {
            console.error('❌ 单独启动 MQTT Server 失败:', err.message);
            process.exit(1);
        }
    })();
}
