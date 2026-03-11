const aedes = require('aedes')();
const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');
const protobuf = require('protobufjs');

class VisualMQTTServer {
    constructor(mqttPort = 3333, httpPort = 2026, host = '127.0.0.1') {
        this.mqttPort = mqttPort;
        this.httpPort = httpPort;
        this.host = host;
        this.mqttServer = null;
        this.httpServer = null;
        this.protoRoot = null;
        
        // 消息分类
        this.serverMessageNames = []; // 下行消息（服务器->客户端）
        this.clientMessageNames = []; // 上行消息（客户端->服务器）
        
        // 消息元数据（包含注释信息）
        this.messageMetadata = {};
        
        // 接收到的上行消息历史
        this.receivedMessages = [];
        this.maxHistorySize = 100;
        
        // 下行消息配置
        this.downlinkConfigs = {};
    // 每条消息的自动发送定时器映射
    this.autoPublishers = {};
        
        // 根据 Protocol.md 定义的状态映射
        this.statusMappings = {
            // 比赛阶段
            current_stage: [
                { value: 0, label: '未开始' },
                { value: 1, label: '准备阶段' },
                { value: 2, label: '自检阶段' },
                { value: 3, label: '倒计时' },
                { value: 4, label: '比赛中' },
                { value: 5, label: '结算中' }
            ],
            // 基地状态
            base_status: [
                { value: 0, label: '无敌' },
                { value: 1, label: '解除无敌护甲未展开' },
                { value: 2, label: '解除无敌护甲展开' }
            ],
            // 前哨站状态
            outpost_status: [
                { value: 0, label: '无敌' },
                { value: 1, label: '存活转' },
                { value: 2, label: '存活停' },
                { value: 3, label: '毁不可建' },
                { value: 4, label: '毁可建' }
            ],
            // 连接状态
            connection_state: [
                { value: 0, label: '未连接' },
                { value: 1, label: '连接' }
            ],
            // 上场状态
            field_state: [
                { value: 0, label: '已上场' },
                { value: 1, label: '未上场' }
            ],
            // 存活状态
            alive_state: [
                { value: 0, label: '未知' },
                { value: 1, label: '存活' },
                { value: 2, label: '战亡' }
            ],
            // 模块状态 (通用)
            power_manager: [{ value: 0, label: '离线' }, { value: 1, label: '在线' }],
            rfid: [{ value: 0, label: '离线' }, { value: 1, label: '在线' }],
            light_strip: [{ value: 0, label: '离线' }, { value: 1, label: '在线' }],
            small_shooter: [{ value: 0, label: '离线' }, { value: 1, label: '在线' }],
            big_shooter: [{ value: 0, label: '离线' }, { value: 1, label: '在线' }],
            uwb: [{ value: 0, label: '离线' }, { value: 1, label: '在线' }],
            armor: [{ value: 0, label: '离线' }, { value: 1, label: '在线' }],
            video_transmission: [{ value: 0, label: '离线' }, { value: 1, label: '在线' }],
            capacitor: [{ value: 0, label: '离线' }, { value: 1, label: '在线' }],
            main_controller: [{ value: 0, label: '离线' }, { value: 1, label: '在线' }],
            // 处罚类型
            penalty_type: [
                { value: 1, label: '黄牌' },
                { value: 2, label: '双方黄牌' },
                { value: 3, label: '红牌' },
                { value: 4, label: '超功率' },
                { value: 5, label: '超热量' },
                { value: 6, label: '超射速' }
            ],
            // 飞镖目标
            target_id: [
                { value: 1, label: '前哨站' },
                { value: 2, label: '基地固定目标' },
                { value: 3, label: '基地随机固定目标' },
                { value: 4, label: '基地随机移动目标' },
                { value: 5, label: '基地末端移动目标' }
            ],
            // 空中支援指令
            command_id: [
                { value: 1, label: '免费呼叫' },
                { value: 2, label: '花费金币呼叫' },
                { value: 3, label: '中断' }
            ],
            // Buff类型
            buff_type: [
                { value: 1, label: '攻击增益' },
                { value: 2, label: '防御增益' },
                { value: 3, label: '冷却增益' },
                { value: 4, label: '功率增益' },
                { value: 5, label: '回血增益' },
                { value: 6, label: '发弹增益' },
                { value: 7, label: '地形跨越增益' }
            ],
            // 能量机关状态
            rune_status: [
                { value: 1, label: '未激活' },
                { value: 2, label: '正在激活' },
                { value: 3, label: '已激活' }
            ],
            // 科技核心状态
            core_status: [
                { value: 1, label: '未进入装配状态' },
                { value: 2, label: '进入装配状态' },
                { value: 3, label: '已选择装配难度' },
                { value: 4, label: '装配中' },
                { value: 5, label: '装配完成' },
                { value: 6, label: '已确认装配,科技核心移动中' }
            ],
            // 部署模式状态 (DeployModeStatusSync的status字段)
            deploy_mode_status: [
                { value: 0, label: '未部署' },
                { value: 1, label: '已部署' }
            ],
            // 部署模式
            deploy_status: [
                { value: 0, label: '未部署' },
                { value: 1, label: '已部署' }
            ],
            // 空中支援状态
            airsupport_status: [
                { value: 0, label: '未进行空中支援' },
                { value: 1, label: '正在空中支援' },
                { value: 2, label: '空中支援被锁定' }
            ],
            // 哨兵姿态
            posture_id: [
                { value: 1, label: '进攻姿态' },
                { value: 2, label: '防御姿态' },
                { value: 3, label: '移动姿态' }
            ],
            intention: [
                { value: 1, label: '攻击' },
                { value: 2, label: '防守' },
                { value: 3, label: '移动' }
            ],
            // 装配操作
            operation: [
                { value: 1, label: '确认装配' },
                { value: 2, label: '取消装配' }
            ],
            // 性能体系
            shooter: [
                { value: 1, label: '冷却优先' },
                { value: 2, label: '爆发优先' },
                { value: 3, label: '英雄近战优先' },
                { value: 4, label: '英雄远程优先' }
            ],
            chassis: [
                { value: 1, label: '血量优先' },
                { value: 2, label: '功率优先' },
                { value: 3, label: '英雄近战优先' },
                { value: 4, label: '英雄远程优先' }
            ],
            performance_system_shooter: [
                { value: 1, label: '冷却优先' },
                { value: 2, label: '爆发优先' },
                { value: 3, label: '英雄近战优先' },
                { value: 4, label: '英雄远程优先' }
            ],
            performance_system_chassis: [
                { value: 1, label: '血量优先' },
                { value: 2, label: '功率优先' },
                { value: 3, label: '英雄近战优先' },
                { value: 4, label: '英雄远程优先' }
            ],
            // 地图点击发送范围
            is_send_all: [
                { value: 0, label: '指定客户端' },
                { value: 1, label: '除哨兵' },
                { value: 2, label: '包含哨兵' }
            ],
            // 标记模式
            mode: [
                { value: 1, label: '地图' },
                { value: 2, label: '对方机器人' }
            ],
            // 标记类型
            type: [
                { value: 1, label: '攻击' },
                { value: 2, label: '防御' },
                { value: 3, label: '警戒' },
                { value: 4, label: '自定义' }
            ],
            // 英雄部署模式指令
            hero_deploy_mode: [
                { value: 0, label: '退出' },
                { value: 1, label: '进入' }
            ],
            // 能量机关激活
            activate: [
                { value: 0, label: '否' },
                { value: 1, label: '开启' }
            ],
            // 结果码
            result_code: [
                { value: 0, label: '成功' },
                { value: 1, label: '失败' }
            ],
            // 机制ID
            mechanism_id: [
                { value: 1, label: '己方堡垒被占领' },
                { value: 2, label: '对方堡垒被占领' }
            ],
            // 是否高亮
            is_high_light: [
                { value: 0, label: '否' },
                { value: 1, label: '是' }
            ]
        };
        
        // 消息名称友好显示映射
        this.messageDisplayNames = {
            GlobalUnitStatus: '全局单位状态',
            GameStatus: '比赛状态',
            GlobalLogisticsStatus: '全局后勤状态',
            GlobalSpecialMechanism: '全局特殊机制',
            Event: '事件通知',
            RobotInjuryStat: '机器人受伤统计',
            RobotRespawnStatus: '机器人复活状态',
            RobotStaticStatus: '机器人静态状态',
            RobotDynamicStatus: '机器人动态状态',
            RobotModuleStatus: '机器人模块状态',
            RobotPosition: '机器人位置',
            Buff: 'Buff 信息',
            PenaltyInfo: '判罚信息',
            RobotPathPlanInfo: '哨兵轨迹规划',
            RaderInfoToClient: '雷达位置信息',
            CustomByteBlock: '自定义数据块',
            TechCoreMotionStateSync: '科技核心运动状态',
            RobotPerformanceSelectionSync: '性能体系状态',
            DeployModeStatus: '部署模式状态',
            RuneStatusSync: '能量机关状态',
            SentinelStatusSync: '哨兵状态',
            DartSelectTargetStatusSync: '飞镖目标选择状态',
            GuardCtrlResult: '哨兵控制结果',
            AirSupportStatusSync: '空中支援状态'
        };

        // 每条消息默认频率 (Hz) - 依据 Protocol.md
        this.messageDefaultFrequencies = {
            GameStatus: 5, // 5Hz
            GlobalUnitStatus: 1, // 1Hz
            GlobalLogisticsStatus: 1, // 1Hz
            GlobalSpecialMechanism: 1, // 1Hz
            RobotInjuryStat: 1, // 1Hz
            RobotRespawnStatus: 1, // 1Hz
            RobotStaticStatus: 1, // 1Hz
            RobotDynamicStatus: 10, // 10Hz
            RobotModuleStatus: 1, // 1Hz
            RobotPosition: 1, // 1Hz
            Buff: 1, // 1Hz
            PenaltyInfo: 1, // trigger
            RobotPathPlanInfo: 1, // 1Hz
            RaderInfoToClient: 1, // 1Hz
            CustomByteBlock: 50, // 50Hz
            TechCoreMotionStateSync: 1, // 1Hz
            RobotPerformanceSelectionSync: 1, // 1Hz
            DeployModeStatusSync: 1, // 1Hz
            RuneStatusSync: 1, // 1Hz
            SentinelStatusSync: 1, // 1Hz
            DartSelectTargetStatusSync: 1, // 1Hz
            GuardCtrlResult: 1, // 1Hz
            AirSupportStatusSync: 1 // 1Hz
        };
        
        // 自动发送配置
        this.autoPublishInterval = null;
        this.autoPublishEnabled = false;
        this.autoPublishIntervalMs = 3000;
    }

    async loadProto() {
        try {
            const protoPath = path.join(__dirname, '..', 'proto', 'messages.proto');
            const protoText = fs.readFileSync(protoPath, 'utf8');

            // 分割proto文件为两个package
            const lines = protoText.split(/\r?\n/);
            const upIndex = lines.findIndex(l => /^\s*package\s+rm_client_up\s*;/.test(l));
            const downIndex = lines.findIndex(l => /^\s*package\s+rm_client_down\s*;/.test(l));

            // 构建上行消息proto
            const upProto = [
                'syntax = "proto3";',
                'package rm_client_up;',
                ...lines.slice(upIndex + 1, downIndex)
            ].join('\n');

            // 构建下行消息proto
            const downProto = [
                'syntax = "proto3";',
                'package rm_client_down;',
                ...lines.slice(downIndex + 1)
            ].join('\n');

            // 解析两个proto
            const upParsed = protobuf.parse(upProto);
            const downParsed = protobuf.parse(downProto);

            // 创建合并的root
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

            // 解析消息和注释
            this.parseProtoMessages(protoText);

            console.log('✅ Protobuf 定义加载成功');
            console.log(`📤 下行消息 (服务器->客户端): ${this.serverMessageNames.length} 个`);
            console.log(`📥 上行消息 (客户端->服务器): ${this.clientMessageNames.length} 个`);

            return true;
        } catch (error) {
            console.error('❌ Protobuf 加载失败:', error.message);
            return false;
        }
    }

    parseProtoMessages(protoText) {
        const lines = protoText.split(/\r?\n/);
        
        // 找到两个package的位置
        const upIndex = lines.findIndex(l => /^\s*package\s+rm_client_up\s*;/.test(l));
        const downIndex = lines.findIndex(l => /^\s*package\s+rm_client_down\s*;/.test(l));
        
        // 解析上行消息（客户端->服务器）
        if (upIndex !== -1) {
            const endIdx = downIndex !== -1 ? downIndex : lines.length;
            this.parseMessageBlock(lines, upIndex + 1, endIdx, 'client');
        }
        
        // 解析下行消息（服务器->客户端）
        if (downIndex !== -1) {
            this.parseMessageBlock(lines, downIndex + 1, lines.length, 'server');
        }
    }

    parseMessageBlock(lines, startIdx, endIdx, type) {
    let currentMessage = null;
    let currentField = null;
    let messageComments = [];
    let fieldComments = [];
        
        for (let i = startIdx; i < endIdx; i++) {
            const line = lines[i].trim();
            
            // 收集注释（区分消息注释和字段注释）
            if (line.startsWith('//')) {
                const comment = line.replace(/^\/\/\s*/, '');
                if (!currentMessage) {
                    // 消息级注释（在 message 声明之前）
                    messageComments.push(comment);
                } else {
                    // 字段注释（在消息内部，作用于下一行字段）
                    fieldComments.push(comment);
                }
                continue;
            }
            
            // 解析消息定义
            const msgMatch = line.match(/^\s*message\s+([A-Za-z0-9_]+)\s*\{/);
            if (msgMatch) {
                currentMessage = msgMatch[1];
                
                if (type === 'server') {
                    this.serverMessageNames.push(currentMessage);
                } else {
                    this.clientMessageNames.push(currentMessage);
                }
                
                // 清理消息描述：移除序号和重复的消息名
                let cleanedDescription = messageComments.join(' ');
                // 移除 "2.2.X MessageName" 格式
                cleanedDescription = cleanedDescription.replace(/^\d+\.\d+\.\d+\s+\w+\s*/, '');
                // 移除 "用途:" 前缀（保留用途内容）
                cleanedDescription = cleanedDescription.replace(/^用途:\s*/, '');
                
                // 生成友好的显示名称：优先使用 messageDisplayNames 映射（Protocol.md），否则使用清理后的描述或消息名
                const displayName = this.messageDisplayNames[currentMessage] || this.messageDisplayNames[cleanedDescription] || cleanedDescription || currentMessage;

                this.messageMetadata[currentMessage] = {
                    type: type,
                    description: cleanedDescription,
                    displayName: displayName,
                    fields: {},
                    comments: [...messageComments],
                    enumComments: {}  // 存储字段的枚举注释
                };
                
                messageComments = [];
                fieldComments = [];
                continue;
            }
            
            // 解析字段
            if (currentMessage) {
                const fieldMatch = line.match(/^\s*(repeated\s+)?(\w+)\s+(\w+)\s*=\s*(\d+)(?:\s*\[([^\]]+)\])?;(?:\s*\/\/\s*(.*))?/);
                if (fieldMatch) {
                    const [, repeated, fieldType, fieldName, fieldNumber, options, comment] = fieldMatch;
                    
                    // 检查之前的注释中是否有枚举定义
                    let enumComment = null;
                    for (const fc of fieldComments) {
                        if (fc.includes(fieldName) && fc.includes('枚举')) {
                            enumComment = fc;
                            break;
                        }
                    }
                    
                    const fieldDesc = fieldComments.filter(fc => !fc.includes('枚举')).join(' ') || comment || '';
                    
                    this.messageMetadata[currentMessage].fields[fieldName] = {
                        type: fieldType,
                        repeated: !!repeated,
                        number: parseInt(fieldNumber),
                        options: options || '',
                        comment: comment || '',
                        description: fieldDesc,
                        enumComment: enumComment  // 保存枚举注释
                    };
                    
                    // 如果有枚举注释，也存储到消息的enumComments中
                    if (enumComment) {
                        this.messageMetadata[currentMessage].enumComments[fieldName] = enumComment;
                    }
                    
                    fieldComments = [];
                }
                
                // 消息结束
                if (line === '}') {
                    currentMessage = null;
                    fieldComments = [];
                }
            }
        }
    }

    async startMQTT() {
        return new Promise((resolve, reject) => {
            this.mqttServer = net.createServer(aedes.handle);

            this.mqttServer.on('error', (err) => {
                console.error(`❌ MQTT 服务器错误: ${err.message}`);
                reject(err);
            });

            // 监听客户端连接
            aedes.on('client', (client) => {
                console.log(`📱 MQTT 客户端已连接: ${client.id}`);
            });

            // 监听客户端断开
            aedes.on('clientDisconnect', (client) => {
                console.log(`📴 MQTT 客户端已断开: ${client.id}`);
            });

            // 监听订阅
            aedes.on('subscribe', (subscriptions, client) => {
                console.log(`📌 客户端 ${client.id} 订阅:`, subscriptions.map(s => s.topic).join(', '));
            });

            // 监听客户端发布的消息
            aedes.on('publish', async (packet, client) => {
                if (!client) return;
                
                const topic = packet.topic;
                
                // 尝试解析消息
                for (const msgName of this.clientMessageNames) {
                    if (topic.includes(msgName) || topic === msgName) {
                        try {
                            const MessageType = this.protoRoot.lookupType(`rm_client_up.${msgName}`);
                            const decoded = MessageType.decode(packet.payload);
                            const obj = MessageType.toObject(decoded, {
                                longs: String,
                                enums: String,
                                bytes: String,
                                keepCase: true
                            });

                            // 解析字段的实际含义
                            const parsedData = this.parseFieldValues(msgName, obj);
                            
                            // 保存到历史记录
                            this.receivedMessages.unshift({
                                timestamp: new Date().toISOString(),
                                clientId: client.id,
                                topic: topic,
                                messageType: msgName,
                                data: obj,
                                parsedData: parsedData  // 添加解析后的数据
                            });
                            
                            // 限制历史记录大小
                            if (this.receivedMessages.length > this.maxHistorySize) {
                                this.receivedMessages = this.receivedMessages.slice(0, this.maxHistorySize);
                            }
                            
                            console.log(`📥 收到上行消息 - 客户端: ${client.id}, 类型: ${msgName}`);
                            
                        } catch (err) {
                            console.error(`❌ 解析消息失败 (${msgName}):`, err.message);
                        }
                        break;
                    }
                }
            });

            this.mqttServer.listen(this.mqttPort, this.host, () => {
                console.log(`✅ MQTT 服务已启动 - mqtt://${this.host}:${this.mqttPort}`);
                resolve();
            });
        });
    }

    startHTTP() {
        this.httpServer = http.createServer((req, res) => {
            // 设置CORS
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            
            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }

            const url = new URL(req.url, `http://${req.headers.host}`);
            
            // 路由处理
            if (url.pathname === '/' || url.pathname === '/index.html') {
                this.serveHTML(res);
            } else if (url.pathname === '/api/messages') {
                this.handleGetMessages(res);
            } else if (url.pathname === '/api/uplink-history') {
                this.handleGetUplinkHistory(res);
            } else if (url.pathname === '/api/publish' && req.method === 'POST') {
                this.handlePublish(req, res);
            } else if (url.pathname === '/api/auto-publish' && req.method === 'POST') {
                this.handleAutoPublish(req, res);
            } else {
                res.writeHead(404);
                res.end('Not Found');
            }
        });

        this.httpServer.listen(this.httpPort, this.host, () => {
            console.log(`✅ Web 可视化界面已启动 - http://${this.host}:${this.httpPort}`);
            console.log(`🌐 请在浏览器中打开: http://${this.host}:${this.httpPort}`);
        });
    }

    serveHTML(res) {
        const html = this.generateHTML();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
    }

    handleGetMessages(res) {
        const response = {
            serverMessages: this.serverMessageNames.map(name => ({
                name: name,
                metadata: this.messageMetadata[name]
            })),
            clientMessages: this.clientMessageNames.map(name => ({
                name: name,
                metadata: this.messageMetadata[name]
            })),
            statusMappings: this.statusMappings  // 添加状态映射
            , messageDefaultFrequencies: this.messageDefaultFrequencies,
            autoPublishers: Object.keys(this.autoPublishers)
        };
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
    }

    handleGetUplinkHistory(res) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.receivedMessages));
    }

    handlePublish(req, res) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { messageType, data, topic } = JSON.parse(body);

                // 获取消息类型（下行消息使用 rm_client_down 包）
                const MessageType = this.protoRoot.lookupType(`rm_client_down.${messageType}`);
                
                // 转换数据
                const convertedData = this.convertKeysToCamel(data);
                
                // 验证数据
                const errMsg = MessageType.verify(convertedData);
                if (errMsg) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: `数据验证失败: ${errMsg}` }));
                    return;
                }
                
                // 创建并编码消息
                const message = MessageType.create(convertedData);
                const buffer = MessageType.encode(message).finish();
                
                // 发布到MQTT
                const publishTopic = topic || messageType;
                aedes.publish({
                    topic: publishTopic,
                    payload: buffer,
                    qos: 0,
                    retain: false
                }, (err) => {
                    if (err) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } else {
                        console.log(`📤 手动发送下行消息 - 类型: ${messageType}, 大小: ${buffer.length} 字节`);
                            // 保存为自动发送模板
                            this.downlinkConfigs[messageType] = convertedData;
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ 
                            success: true, 
                            topic: publishTopic,
                            size: buffer.length 
                        }));
                    }
                });
                
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
    }

    handleAutoPublish(req, res) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { messageType, enabled, intervalMs, topic, data } = JSON.parse(body);
                
                if (!messageType) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'messageType is required' }));
                    return;
                }
                
                if (enabled) {
                    // store template data for this message
                    if (data) {
                        this.downlinkConfigs[messageType] = data;
                    }
                    this.startAutoPublishForMessage(messageType, intervalMs || this.messageDefaultFrequencies[messageType], topic);
                } else {
                    this.stopAutoPublishForMessage(messageType);
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true,
                    messageType: messageType,
                    enabled: !!this.autoPublishers[messageType],
                    intervalMs: this.autoPublishers[messageType]?.intervalMs || 0
                }));
                
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
    }

    startAutoPublishForMessage(messageType, intervalMs, topic) {
        if (this.autoPublishers[messageType]) {
            clearInterval(this.autoPublishers[messageType].timer);
            this.autoPublishers[messageType] = null;
        }
        const ms = intervalMs || this.messageDefaultFrequencies[messageType] || 1000;
        const publishTopic = topic || messageType;
        const template = this.downlinkConfigs[messageType] || this.generateMockData(messageType) || {};

        const timer = setInterval(() => {
            try {
                const MessageType = this.protoRoot.lookupType(`rm_client_down.${messageType}`);
                const convertedData = this.convertKeysToCamel(template);
                const errMsg = MessageType.verify(convertedData);
                if (errMsg) return;
                const message = MessageType.create(convertedData);
                const buffer = MessageType.encode(message).finish();
                aedes.publish({ topic: publishTopic, payload: buffer, qos: 0, retain: false });
                console.log(`📤 自动发送下行消息 - 类型: ${messageType}, 大小: ${buffer.length} 字节`);
            } catch (error) {
                console.error(`❌ 自动发送失败 (${messageType}):`, error.message);
            }
        }, ms);

        this.autoPublishers[messageType] = { timer, intervalMs: ms, topic: publishTopic };
        console.log(`🚀 开始自动发送下行消息(${messageType})，间隔: ${ms}ms`);
    }

    stopAutoPublishForMessage(messageType) {
        const p = this.autoPublishers[messageType];
        if (p && p.timer) {
            clearInterval(p.timer);
            delete this.autoPublishers[messageType];
            console.log(`⏹️ 停止自动发送下行消息(${messageType})`);
        }
    }

    generateMockData(messageType) {
        // 根据消息类型生成模拟数据
        const mockDataTemplates = {
            'GameStatus': {
                currentRound: 1,
                totalRounds: 3,
                redScore: Math.floor(Math.random() * 100),
                blueScore: Math.floor(Math.random() * 100),
                currentStage: 4,
                stageCountdownSec: Math.floor(Math.random() * 420),
                stageElapsedSec: Math.floor(Math.random() * 420),
                isPaused: false
            },
            'RobotDynamicStatus': {
                currentHealth: Math.floor(Math.random() * 600),
                currentHeat: Math.random() * 100,
                lastProjectileFireRate: 15 + Math.random() * 3,
                currentChassisEnergy: Math.floor(Math.random() * 60),
                currentBufferEnergy: Math.floor(Math.random() * 100),
                currentExperience: Math.floor(Math.random() * 500),
                experienceForUpgrade: 1000,
                totalProjectilesFired: Math.floor(Math.random() * 200),
                remainingAmmo: Math.floor(Math.random() * 200),
                isOutOfCombat: Math.random() > 0.5,
                outOfCombatCountdown: Math.floor(Math.random() * 10),
                canRemoteHeal: true,
                canRemoteAmmo: true
            },
            'RobotPosition': {
                x: Math.random() * 28 - 14,
                y: Math.random() * 15 - 7.5,
                z: 0.5,
                yaw: Math.random() * 360
            },
            'GlobalUnitStatus': {
                baseHealth: Math.floor(Math.random() * 5000),
                baseStatus: 1,
                baseShield: Math.floor(Math.random() * 500),
                outpostHealth: Math.floor(Math.random() * 1500),
                outpostStatus: 1,
                robotHealth: Array(10).fill(0).map(() => Math.floor(Math.random() * 600)),
                robotBullets: Array(5).fill(0).map(() => Math.floor(Math.random() * 200)),
                totalDamageRed: Math.floor(Math.random() * 5000),
                totalDamageBlue: Math.floor(Math.random() * 5000)
            }
        };
        
        return mockDataTemplates[messageType] || null;
    }

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

    parseFieldValues(messageType, data) {
        const metadata = this.messageMetadata[messageType];
        const parsed = {};

        for (const [fieldName, value] of Object.entries(data)) {
            let fieldMeta = null;

            // 尝试查找字段元数据
            if (metadata && metadata.fields) {
                fieldMeta = metadata.fields[fieldName];
                if (!fieldMeta) {
                    const snakeName = fieldName.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
                    fieldMeta = metadata.fields[snakeName];
                }
                if (!fieldMeta) {
                    const camelName = fieldName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
                    fieldMeta = metadata.fields[camelName];
                }
            }

            // 如果没有元数据，使用默认显示
            if (!fieldMeta) {
                parsed[fieldName] = { value, display: String(value) };
                continue;
            }

            let display = String(value);
            let description = fieldMeta.description || fieldMeta.comment || '';
            
            // 优先使用 Protocol.md 的状态映射
            const statusMapping = this.statusMappings[fieldName];
            if (statusMapping && Array.isArray(statusMapping)) {
                const mapping = statusMapping.find(m => m.value === value);
                if (mapping) {
                    display = `${value} (${mapping.label})`;
                }
            }
            // 解析布尔值
            else if (fieldMeta.type === 'bool') {
                // 根据字段名称推断含义
                if (fieldName.includes('button') || fieldName.includes('down')) {
                    display = value ? '按下' : '抬起';
                } else if (fieldName.includes('is_') || fieldName.includes('can_')) {
                    display = value ? '是' : '否';
                } else if (fieldName.includes('open')) {
                    display = value ? '开启' : '关闭';
                } else if (description.includes('false') || description.includes('true')) {
                    const match = description.match(/(false|抬起|否)[^a-zA-Z]*[:：=]?([^,，)]+).*?(true|按下|是)[^a-zA-Z]*[:：=]?([^,，)]+)/i);
                    if (match) {
                        const falseText = match[2]?.trim() || '否';
                        const trueText = match[4]?.trim() || '是';
                        display = value ? trueText : falseText;
                    } else {
                        display = value ? '是' : '否';
                    }
                } else {
                    display = value ? '是' : '否';
                }
            }
            // 解析数值（带方向或状态说明）
            else if ((fieldMeta.type === 'int32' || fieldMeta.type === 'float') && description) {
                display = String(value);
                
                // 检查是否有方向说明
                if (fieldName.toLowerCase().includes('mouse')) {
                    if (value < 0) {
                        if (description.includes('向左') || fieldName.includes('_x')) display += ' (向左)';
                        else if (description.includes('向下') || fieldName.includes('_y')) display += ' (向下)';
                        else if (description.includes('向后') || fieldName.includes('_z')) display += ' (向后滚动)';
                    } else if (value > 0) {
                        if (description.includes('向左') || fieldName.includes('_x')) display += ' (向右)';
                        else if (description.includes('向下') || fieldName.includes('_y')) display += ' (向上)';
                        else if (description.includes('向后') || fieldName.includes('_z')) display += ' (向前滚动)';
                    }
                }
            }
            // 解析枚举值（作为fallback）
            else if (fieldMeta.type === 'uint32' && description) {
                const enumComment = this.findEnumComment(metadata, fieldName);
                if (enumComment) {
                    const enumValue = this.parseEnumValue(enumComment, value);
                    if (enumValue) {
                        display = `${value} (${enumValue})`;
                    }
                }
            }

            parsed[fieldName] = {
                value: value,
                display: display,
                description: description,
                type: fieldMeta.type
            };
        }

        return parsed;
    }

    findEnumComment(metadata, fieldName) {
        // 优先使用解析时存储的枚举注释映射
        if (metadata.enumComments && metadata.enumComments[fieldName]) {
            return metadata.enumComments[fieldName];
        }
        // 兼容性：在消息级注释中查找枚举定义（老 proto 的注释可能写在消息上方）
        if (Array.isArray(metadata.comments)) {
            for (const comment of metadata.comments) {
                if (comment.includes(fieldName) && comment.includes('枚举')) {
                    return comment;
                }
            }
        }
        return null;
    }

    parseEnumValue(enumComment, value) {
        // 解析枚举注释，格式如: "枚举值: 0:未开始, 1:准备, 2:自检, 3:倒计时, 4:比赛中, 5:结算"
        const match = enumComment.match(/枚举[^:]*:\s*(.+)/);
        if (!match) return null;

        const enumPart = match[1];
        const pairs = enumPart.split(/[,，、]/);
        
        for (const pair of pairs) {
            const pairMatch = pair.trim().match(/^(\d+)\s*[:：]\s*(.+)/);
            if (pairMatch) {
                const enumKey = parseInt(pairMatch[1]);
                const enumValue = pairMatch[2].trim();
                if (enumKey === value) {
                    return enumValue;
                }
            }
        }
        
        return null;
    }

    generateHTML() {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MQTT 服务器可视化控制台</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1600px;
            margin: 0 auto;
        }
        
        header {
            background: white;
            padding: 20px 30px;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            margin-bottom: 20px;
        }
        
        h1 {
            color: #333;
            font-size: 28px;
            margin-bottom: 10px;
        }
        
        .subtitle {
            color: #666;
            font-size: 14px;
        }
        
        .main-content {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }
        
        .panel {
            background: white;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        
        .panel-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 15px 20px;
            font-size: 18px;
            font-weight: bold;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .panel-body {
            padding: 20px;
            max-height: 600px;
            overflow-y: auto;
        }
        
        .message-item {
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 15px;
            cursor: pointer;
            transition: all 0.3s;
        }
        
        .message-item:hover {
            border-color: #667eea;
            box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
        }
        
        .message-item.active {
            border-color: #667eea;
            background: #f0f4ff;
        }
        
        .message-name {
            font-size: 16px;
            font-weight: bold;
            color: #333;
            margin-bottom: 5px;
        }
        
        .message-desc {
            font-size: 13px;
            color: #666;
            margin-bottom: 10px;
        }
        .message-subdesc {
            font-size: 12px;
            color: #999;
            margin-top: -6px;
            margin-bottom: 8px;
            line-height: 1.2;
        }
        
        .field-list {
            margin-top: 10px;
            display: none;
        }
        
        .message-item.active .field-list {
            display: block;
        }
        
        .field-item {
            background: #f8f9fa;
            padding: 8px 12px;
            border-radius: 5px;
            margin-bottom: 8px;
            font-size: 12px;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            flex-wrap: wrap;
        }
        
        .field-left {
            flex: 1;
            min-width: 200px;
        }
        
        .field-right {
            margin-left: 10px;
            min-width: 150px;
        }
        
        /* 上行消息的接收值显示区域 */
        .field-right.received {
            background: #e8f5e9;
            padding: 4px 10px;
            border-radius: 4px;
            border-left: 3px solid #28a745;
        }
        
        .field-name {
            font-weight: bold;
            color: #667eea;
        }
        
        .field-type {
            color: #999;
            font-style: italic;
        }
        
        .field-comment {
            color: #666;
            margin-top: 3px;
        }
        
        .field-value-label {
            font-size: 11px;
            color: #28a745;
            font-weight: bold;
            margin-bottom: 2px;
        }
        
        .field-value-display {
            color: #1565c0;
            font-weight: bold;
            font-size: 13px;
        }
        
        /* 上行消息接收到的数据显示样式 */
        .field-value-empty {
            color: #999;
            font-style: italic;
            font-size: 12px;
        }
        
        .field-value-received {
            color: #1565c0;
            font-weight: bold;
            font-size: 14px;
            margin-bottom: 4px;
        }
        
        .field-value-desc {
            color: #666;
            font-size: 11px;
            margin-top: 4px;
            font-style: italic;
        }
        
        .field-value-time {
            color: #999;
            font-size: 10px;
            margin-top: 4px;
            text-align: right;
        }
        
        .field-input-section {
            background: #fff3cd;
            padding: 8px 10px;
            border-radius: 4px;
            border-left: 3px solid #ffc107;
            margin-left: 10px;
            min-width: 150px;
        }
        
        .field-input-label {
            font-size: 11px;
            color: #856404;
            font-weight: bold;
            margin-bottom: 5px;
            display: block;
        }
        
        .field-input {
            width: 100%;
            padding: 6px 8px;
            border: 1px solid #ddd;
            border-radius: 3px;
            font-size: 12px;
            font-family: 'Consolas', 'Monaco', monospace;
            min-height: 28px;
            line-height: 1.4;
        }
        
        .field-select {
            width: 100%;
            padding: 6px 8px;
            border: 1px solid #ddd;
            border-radius: 3px;
            font-size: 12px;
            background: white;
            min-height: 28px;
            line-height: 1.4;
        }
        
        .send-message-btn {
            margin-top: 10px;
            padding: 8px 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 5px;
            font-size: 13px;
            font-weight: bold;
            cursor: pointer;
            width: 100%;
        }
        
        .send-message-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 2px 6px rgba(102, 126, 234, 0.3);
        }
        
        .form-group {
            margin-bottom: 15px;
        }
        
        .form-label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
            color: #333;
            font-size: 14px;
        }
        
        .form-input {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 5px;
            font-size: 14px;
        }
        
        .form-textarea {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 5px;
            font-size: 13px;
            font-family: 'Consolas', 'Monaco', monospace;
            min-height: 200px;
        }
        
        .btn {
            padding: 10px 20px;
            border: none;
            border-radius: 5px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s;
        }
        
        .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        
        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(102, 126, 234, 0.3);
        }
        
        .btn-success {
            background: #28a745;
            color: white;
        }
        
        .btn-danger {
            background: #dc3545;
            color: white;
        }
        
        .btn-group {
            display: flex;
            gap: 10px;
        }
        
        .history-item {
            background: #f8f9fa;
            border-left: 4px solid #667eea;
            padding: 12px 15px;
            margin-bottom: 12px;
            border-radius: 5px;
        }
        
        .history-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 13px;
        }
        
        .history-type {
            font-weight: bold;
            color: #667eea;
        }
        
        .history-time {
            color: #999;
            font-size: 12px;
        }
        
        .history-data {
            background: white;
            padding: 10px;
            border-radius: 4px;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 12px;
            overflow-x: auto;
        }
        
        .field-display {
            margin-bottom: 5px;
            padding: 5px;
            background: #f8f9fa;
            border-radius: 3px;
        }
        
        .field-display-name {
            font-weight: bold;
            color: #495057;
            margin-right: 8px;
        }
        
        .field-display-value {
            color: #007bff;
            font-weight: bold;
        }
        
        .field-display-desc {
            color: #6c757d;
            font-size: 11px;
            margin-top: 2px;
        }
        
        .badge {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: bold;
            margin-left: 8px;
        }
        
        .badge-up {
            background: #28a745;
            color: white;
        }
        
        .badge-down {
            background: #007bff;
            color: white;
        }
        
        .auto-publish-control {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        
        .auto-publish-control h3 {
            margin-bottom: 10px;
            color: #333;
            font-size: 16px;
        }
        
        .status-indicator {
            display: inline-block;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            margin-right: 5px;
        }
        
        .status-active {
            background: #28a745;
            box-shadow: 0 0 5px #28a745;
        }
        
        .status-inactive {
            background: #dc3545;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🚀 MQTT 服务器可视化控制台</h1>
            <div class="subtitle">RoboMaster 2026 自定义客户端通信协议 - 数据配置与监控</div>
        </header>
        
        <div class="main-content">
            <!-- 左侧：上行消息 -->
            <div class="panel">
                <div class="panel-header">
                    📥 上行消息（客户端 → 服务器）
                    <span class="badge badge-up" id="uplinkCount">0</span>
                </div>
                <div class="panel-body" id="uplinkMessages">
                    <p style="color: #999; text-align: center; padding: 20px;">加载中...</p>
                </div>
            </div>
            
            <!-- 右侧：下行消息 -->
            <div class="panel">
                <div class="panel-header">
                    📤 下行消息（服务器 → 客户端）
                    <span class="badge badge-down" id="downlinkCount">0</span>
                </div>
                <div class="panel-body" id="downlinkMessages">
                    <p style="color: #999; text-align: center; padding: 20px;">加载中...</p>
                </div>
            </div>
        </div>
        
        <!-- 历史记录 -->
        <div class="panel" style="margin-top: 30px;">
            <div class="panel-header">
                📜 通信历史
                <button class="btn btn-secondary" onclick="refreshHistory()" style="margin-left: auto;">刷新</button>
            </div>
            <div class="panel-body" id="historyPanel">
                <p style="color: #999; text-align: center; padding: 20px;">暂无历史记录</p>
            </div>
        </div>
        
        <!-- 版权信息 -->
        <footer style="text-align: center; padding: 20px 0 30px 0; color: #999; font-size: 12px;">
            江南大学霞客湾校区 MeroT 制作
        </footer>
    </div>
    
    <script>
        let messagesData = null;
        let autoPublishActive = false;
        
        // 加载消息定义
        async function loadMessages() {
            try {
                const response = await fetch('/api/messages');
                messagesData = await response.json();
                
                renderUplinkMessages();
                renderDownlinkMessages();
                populateManualSelect();
            } catch (error) {
                console.error('加载消息定义失败:', error);
            }
        }
        
        // 渲染上行消息
        function renderUplinkMessages() {
            const container = document.getElementById('uplinkMessages');
            const count = document.getElementById('uplinkCount');
            
            if (!messagesData || messagesData.clientMessages.length === 0) {
                container.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">暂无上行消息</p>';
                count.textContent = '0';
                return;
            }
            
            count.textContent = messagesData.clientMessages.length;

            messagesData.clientMessages.forEach(msg => {
                const meta = msg.metadata;
                const item = document.createElement('div');
                item.className = 'message-item';
                item.setAttribute('onclick', 'toggleMessage(this)');

                const nameEl = document.createElement('div');
                nameEl.className = 'message-name';
                nameEl.textContent = msg.name;

                const descEl = document.createElement('div');
                descEl.className = 'message-desc';
                descEl.textContent = meta.displayName || meta.description || '无描述';

                const fieldList = document.createElement('div');
                fieldList.className = 'field-list';

                Object.entries(meta.fields).forEach(([fieldName, field]) => {
                    const fieldItem = document.createElement('div');
                    fieldItem.className = 'field-item';

                    const left = document.createElement('div');
                    left.className = 'field-left';
                    const fn = document.createElement('span'); fn.className = 'field-name'; fn.textContent = fieldName;
                    const ft = document.createElement('span'); ft.className = 'field-type'; ft.textContent = '(' + (field.repeated ? 'repeated ' : '') + field.type + ')';
                    const fc = document.createElement('div'); fc.className = 'field-comment'; fc.textContent = field.description || field.comment || '无说明';
                    left.appendChild(fn); left.appendChild(ft); left.appendChild(fc);

                    const right = document.createElement('div');
                    right.className = 'field-right received';
                    right.id = 'value-' + msg.name + '-' + fieldName;
                    const empty = document.createElement('div'); empty.className = 'field-value-empty'; empty.textContent = '暂无数据';
                    right.appendChild(empty);

                    fieldItem.appendChild(left);
                    fieldItem.appendChild(right);
                    fieldList.appendChild(fieldItem);
                });

                item.appendChild(nameEl);
                item.appendChild(descEl);
                item.appendChild(fieldList);
                container.appendChild(item);
            });
        }
        
        // 渲染下行消息
        function renderDownlinkMessages() {
            const container = document.getElementById('downlinkMessages');
            const count = document.getElementById('downlinkCount');

            container.innerHTML = '';
            if (!messagesData || messagesData.serverMessages.length === 0) {
                container.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">暂无下行消息</p>';
                count.textContent = '0';
                return;
            }

            count.textContent = messagesData.serverMessages.length;

            messagesData.serverMessages.forEach(msg => {
                const meta = msg.metadata;
                const item = document.createElement('div');
                item.className = 'message-item';
                item.setAttribute('onclick', 'toggleMessage(this)');

                const nameEl = document.createElement('div');
                nameEl.className = 'message-name';
                nameEl.textContent = messagesData.messageDisplayNames?.[msg.name] || msg.name;

                const descEl = document.createElement('div');
                descEl.className = 'message-desc';
                descEl.textContent = meta.displayName || meta.description || '无描述';

                const fieldList = document.createElement('div');
                fieldList.className = 'field-list';

                Object.entries(meta.fields).forEach(([fieldName, field]) => {
                    const fieldItem = document.createElement('div');
                    fieldItem.className = 'field-item';

                    const left = document.createElement('div');
                    left.className = 'field-left';
                    const fn = document.createElement('span');
                    fn.className = 'field-name';
                    fn.textContent = fieldName;
                    const ft = document.createElement('span');
                    ft.className = 'field-type';
                    ft.textContent = '(' + (field.repeated ? 'repeated ' : '') + field.type + ')';
                    const fc = document.createElement('div');
                    fc.className = 'field-comment';
                    fc.textContent = field.description || field.comment || '无说明';
                    left.appendChild(fn);
                    left.appendChild(ft);
                    left.appendChild(fc);

                    const inputWrapper = document.createElement('div');
                    inputWrapper.className = 'field-right';
                    const inputHtml = generateFieldInput(msg.name, fieldName, field);
                    inputWrapper.innerHTML = inputHtml;

                    fieldItem.appendChild(left);
                    fieldItem.appendChild(inputWrapper);
                    fieldList.appendChild(fieldItem);
                });

                const opArea = document.createElement('div');
                opArea.style.display = 'flex';
                opArea.style.gap = '10px';
                opArea.style.alignItems = 'center';
                opArea.style.marginTop = '10px';

                const sendBtn = document.createElement('button');
                sendBtn.className = 'send-message-btn';
                sendBtn.textContent = '📤 发送此消息';
                sendBtn.onclick = (e) => {
                    e.stopPropagation();
                    sendDownlinkMessage(msg.name);
                };

                const freqLabel = document.createElement('label');
                freqLabel.className = 'form-label';
                freqLabel.textContent = '频率(Hz)';

                const freqInput = document.createElement('input');
                freqInput.type = 'number';
                freqInput.className = 'form-input';
                freqInput.id = 'autoFreq-' + msg.name;
                freqInput.value = messagesData.messageDefaultFrequencies?.[msg.name] || 1;
                freqInput.min = 0.1;
                freqInput.step = 0.1;
                freqInput.style.width = '100px';

                const checkLabel = document.createElement('label');
                checkLabel.style.display = 'flex';
                checkLabel.style.gap = '6px';
                checkLabel.style.alignItems = 'center';
                checkLabel.style.fontSize = '12px';
                checkLabel.style.color = '#333';

                const checkBox = document.createElement('input');
                checkBox.type = 'checkbox';
                checkBox.id = 'autoEnable-' + msg.name;
                checkBox.onclick = (e) => {
                    e.stopPropagation();
                    toggleAutoPublish(msg.name);
                };

                checkLabel.appendChild(checkBox);
                checkLabel.appendChild(document.createTextNode('自动发送'));

                opArea.appendChild(sendBtn);
                opArea.appendChild(freqLabel);
                opArea.appendChild(freqInput);
                opArea.appendChild(checkLabel);

                item.appendChild(nameEl);
                item.appendChild(descEl);
                item.appendChild(fieldList);
                item.appendChild(opArea);
                container.appendChild(item);
            });
        }
        
        // 生成字段输入框
        function generateFieldInput(messageName, fieldName, fieldMeta) {
            const inputId = \`input-\${messageName}-\${fieldName}\`;
            const description = fieldMeta.description || fieldMeta.comment || '';
            
            // 特殊映射：DeployModeStatusSync的status字段使用deploy_mode_status映射
            let mappingKey = fieldName;
            if (messageName === 'DeployModeStatusSync' && fieldName === 'status') {
                mappingKey = 'deploy_mode_status';
            } else if (messageName === 'TechCoreMotionStateSync' && fieldName === 'status') {
                mappingKey = 'core_status';
            }
            
            // 检查是否有状态映射（优先使用 Protocol.md 定义）
            const statusOptions = messagesData.statusMappings?.[mappingKey];
            if (statusOptions && statusOptions.length > 0) {
                const optionsHtml = statusOptions.map(opt => 
                    \`<option value="\${opt.value}">\${opt.value}: \${opt.label}</option>\`
                ).join('');
                
                return \`
                    <div class="field-input-section" onclick="event.stopPropagation()">
                        <div class="field-input-label">✏️ 选择状态</div>
                        <select class="field-select" id="\${inputId}" data-type="\${fieldMeta.type}">
                            \${optionsHtml}
                        </select>
                    </div>
                \`;
            }
            
            // 布尔类型 - 使用下拉框
            if (fieldMeta.type === 'bool') {
                let options = '';
                if (description.includes('false') || description.includes('true')) {
                    const match = description.match(/(false|抬起|否)[^a-zA-Z]*[:：=]?([^,，)]+).*?(true|按下|是)[^a-zA-Z]*[:：=]?([^,，)]+)/i);
                    if (match) {
                        const falseText = match[2]?.trim() || '抬起/否';
                        const trueText = match[4]?.trim() || '按下/是';
                        options = \`
                            <option value="false">false: \${falseText}</option>
                            <option value="true">true: \${trueText}</option>
                        \`;
                    } else {
                        options = \`
                            <option value="false">false</option>
                            <option value="true">true</option>
                        \`;
                    }
                } else {
                    options = \`
                        <option value="false">false</option>
                        <option value="true">true</option>
                    \`;
                }
                
                return \`
                    <div class="field-input-section" onclick="event.stopPropagation()">
                        <div class="field-input-label">✏️ 设置值</div>
                        <select class="field-select" id="\${inputId}" data-type="bool">
                            \${options}
                        </select>
                    </div>
                \`;
            }
            
            // 枚举类型 - 检查是否有枚举注释（作为fallback）
            const enumComment = fieldMeta.enumComment;
            
            if (enumComment || (fieldMeta.type === 'uint32' && description.includes('枚举'))) {
                const enumOptions = parseEnumOptions(enumComment || description);
                if (enumOptions.length > 0) {
                    const optionsHtml = enumOptions.map(opt => 
                        \`<option value="\${opt.value}">\${opt.value}: \${opt.label}</option>\`
                    ).join('');
                    
                    return \`
                        <div class="field-input-section" onclick="event.stopPropagation()">
                            <div class="field-input-label">✏️ 选择值</div>
                            <select class="field-select" id="\${inputId}" data-type="uint32">
                                \${optionsHtml}
                            </select>
                        </div>
                    \`;
                }
            }
            
            // 数组类型 - 使用文本框，提示输入JSON数组
            if (fieldMeta.repeated) {
                return \`
                    <div class="field-input-section" onclick="event.stopPropagation()">
                        <div class="field-input-label">✏️ 输入值 (数组，如: [1,2,3])</div>
                        <input type="text" class="field-input" id="\${inputId}" 
                               data-type="\${fieldMeta.type}" data-repeated="true"
                               placeholder="[1, 2, 3]" value="[]">
                    </div>
                \`;
            }
            
            // 数值类型 - 使用数字输入框
            if (fieldMeta.type === 'uint32' || fieldMeta.type === 'int32') {
                return \`
                    <div class="field-input-section" onclick="event.stopPropagation()">
                        <div class="field-input-label">✏️ 输入值</div>
                        <input type="number" class="field-input" id="\${inputId}" 
                               data-type="\${fieldMeta.type}"
                               placeholder="0" value="0">
                    </div>
                \`;
            }
            
            // 浮点数类型
            if (fieldMeta.type === 'float' || fieldMeta.type === 'double') {
                return \`
                    <div class="field-input-section" onclick="event.stopPropagation()">
                        <div class="field-input-label">✏️ 输入值</div>
                        <input type="number" step="0.01" class="field-input" id="\${inputId}" 
                               data-type="\${fieldMeta.type}"
                               placeholder="0.0" value="0.0">
                    </div>
                \`;
            }
            
            // 字符串类型
            if (fieldMeta.type === 'string') {
                return \`
                    <div class="field-input-section" onclick="event.stopPropagation()">
                        <div class="field-input-label">✏️ 输入值</div>
                        <input type="text" class="field-input" id="\${inputId}" 
                               data-type="string"
                               placeholder="文本内容" value="">
                    </div>
                \`;
            }
            
            // bytes类型
            if (fieldMeta.type === 'bytes') {
                return \`
                    <div class="field-input-section" onclick="event.stopPropagation()">
                        <div class="field-input-label">✏️ 输入值 (文本或Base64)</div>
                        <input type="text" class="field-input" id="\${inputId}" 
                               data-type="bytes"
                               placeholder="文本内容" value="">
                    </div>
                \`;
            }
            
            // 默认文本输入框
            return \`
                <div class="field-input-section" onclick="event.stopPropagation()">
                    <div class="field-input-label">✏️ 输入值</div>
                    <input type="text" class="field-input" id="\${inputId}" 
                           data-type="\${fieldMeta.type}"
                           placeholder="值" value="">
                </div>
            \`;
        }
        
        // 解析枚举选项
        function parseEnumOptions(description) {
            const match = description.match(/枚举[^:]*:\s*(.+)/);
            if (!match) return [];
            
            const enumPart = match[1];
            const pairs = enumPart.split(/[,，、]/);
            const options = [];
            
            for (const pair of pairs) {
                const pairMatch = pair.trim().match(/^(\d+)\s*[:：]\s*(.+)/);
                if (pairMatch) {
                    options.push({
                        value: parseInt(pairMatch[1]),
                        label: pairMatch[2].trim()
                    });
                }
            }
            
            return options;
        }
        
        // 发送下行消息
        async function sendDownlinkMessage(messageType) {
            try {
                const msg = messagesData.serverMessages.find(m => m.name === messageType);
                if (!msg) return;
                
                const data = {};
                
                // 收集所有字段的值
                for (const [fieldName, fieldMeta] of Object.entries(msg.metadata.fields)) {
                    const inputId = \`input-\${messageType}-\${fieldName}\`;
                    const inputElement = document.getElementById(inputId);
                    
                    if (!inputElement) continue;
                    
                    const dataType = inputElement.getAttribute('data-type');
                    const isRepeated = inputElement.getAttribute('data-repeated') === 'true';
                    let value = inputElement.value;
                    
                    // 转换值
                    if (isRepeated) {
                        try {
                            value = JSON.parse(value);
                        } catch (e) {
                            value = [];
                        }
                    } else if (dataType === 'bool') {
                        value = value === 'true';
                    } else if (dataType === 'uint32' || dataType === 'int32') {
                        value = parseInt(value) || 0;
                    } else if (dataType === 'float' || dataType === 'double') {
                        value = parseFloat(value) || 0.0;
                    }
                    
                    data[fieldName] = value;
                }
                
                // 发送消息
                const response = await fetch('/api/publish', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messageType: messageType,
                        topic: messageType,
                        data: data
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert(\`✅ 发送成功！\\n主题: \${result.topic}\\n大小: \${result.size} 字节\`);
                } else {
                    alert(\`❌ 发送失败: \${result.error}\`);
                }
            } catch (error) {
                alert(\`❌ 错误: \${error.message}\`);
            }
        }
        
        // 填充手动发送下拉框
        function populateManualSelect() {
            const select = document.getElementById('manualMessageType');
            
            if (!messagesData || !select) return; // 添加元素存在检查
            
            messagesData.serverMessages.forEach(msg => {
                const option = document.createElement('option');
                option.value = msg.name;
                option.textContent = msg.name;
                select.appendChild(option);
            });
        }
        
        // 更新手动发送模板
        function updateManualTemplate() {
            const select = document.getElementById('manualMessageType');
            const textarea = document.getElementById('manualData');
            const topicInput = document.getElementById('manualTopic');
            const msgType = select.value;
            
            if (!msgType || !messagesData) return;
            
            topicInput.value = msgType;
            
            const msg = messagesData.serverMessages.find(m => m.name === msgType);
            if (!msg) return;
            
            // 生成示例数据
            const template = {};
            Object.entries(msg.metadata.fields).forEach(([fieldName, field]) => {
                if (field.repeated) {
                    template[fieldName] = [];
                } else if (field.type === 'uint32' || field.type === 'int32') {
                    template[fieldName] = 0;
                } else if (field.type === 'float') {
                    template[fieldName] = 0.0;
                } else if (field.type === 'bool') {
                    template[fieldName] = false;
                } else if (field.type === 'string') {
                    template[fieldName] = "";
                } else {
                    template[fieldName] = null;
                }
            });
            
            textarea.value = JSON.stringify(template, null, 2);
        }
        
        // 手动发送消息
        async function publishManual() {
            const msgType = document.getElementById('manualMessageType').value;
            const topic = document.getElementById('manualTopic').value;
            const dataText = document.getElementById('manualData').value;
            const resultDiv = document.getElementById('publishResult');
            
            if (!msgType) {
                resultDiv.innerHTML = '<p style="color: #dc3545;">请选择消息类型</p>';
                return;
            }
            
            try {
                const data = JSON.parse(dataText);
                
                const response = await fetch('/api/publish', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messageType: msgType,
                        topic: topic || msgType,
                        data: data
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    resultDiv.innerHTML = \`<p style="color: #28a745;">✅ 发送成功！主题: \${result.topic}, 大小: \${result.size} 字节</p>\`;
                } else {
                    resultDiv.innerHTML = \`<p style="color: #dc3545;">❌ 发送失败: \${result.error}</p>\`;
                }
            } catch (error) {
                resultDiv.innerHTML = \`<p style="color: #dc3545;">❌ 错误: \${error.message}</p>\`;
            }
        }
        
        // 采集消息当前的输入数据
        function collectMessageData(messageType) {
            const msg = messagesData.serverMessages.find(m => m.name === messageType);
            if (!msg) return {};
            const data = {};
            for (const [fieldName, fieldMeta] of Object.entries(msg.metadata.fields)) {
                const inputId = 'input-' + messageType + '-' + fieldName;
                const inputElement = document.getElementById(inputId);
                if (!inputElement) continue;
                const dataType = inputElement.getAttribute('data-type');
                const isRepeated = inputElement.getAttribute('data-repeated') === 'true';
                let value = inputElement.value;
                if (isRepeated) {
                    try { value = JSON.parse(value); } catch (e) { value = []; }
                } else if (dataType === 'bool') { value = value === 'true'; }
                else if (dataType === 'uint32' || dataType === 'int32') { value = parseInt(value) || 0; }
                else if (dataType === 'float' || dataType === 'double') { value = parseFloat(value) || 0.0; }
                data[fieldName] = value;
            }
            return data;
        }

        // 切换某条消息的自动发送
        async function toggleAutoPublish(messageType) {
            try {
                const checkbox = document.getElementById('autoEnable-' + messageType);
                const freqInput = document.getElementById('autoFreq-' + messageType);
                const enabled = checkbox.checked;
                const freqHz = parseFloat(freqInput.value) || messagesData.messageDefaultFrequencies?.[messageType] || 1;
                const intervalMs = Math.round(1000 / freqHz); // 将Hz转换为ms
                const data = collectMessageData(messageType);

                const response = await fetch('/api/auto-publish', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ messageType, enabled, intervalMs: intervalMs, topic: messageType, data })
                });
                const result = await response.json();
                if (!result.success) {
                    alert('自动发送失败: ' + (result.error || 'unknown'));
                    checkbox.checked = !enabled; // revert
                }
                // Optional: update UI indicator
            } catch (error) {
                alert('自动发送发生错误: ' + error.message);
            }
        }
        
        // 更新自动发送状态
        function updateAutoStatus() {
            const indicator = document.getElementById('autoStatus');
            if (!indicator) return; // 如果元素不存在则返回
            
            if (autoPublishActive) {
                indicator.className = 'status-indicator status-active';
            } else {
                indicator.className = 'status-indicator status-inactive';
            }
        }
        
        // 更新上行消息接收到的数据显示
        function updateUplinkReceivedData(messageType, parsedData) {
            for (const [fieldName, fieldInfo] of Object.entries(parsedData)) {
                // 将 camelCase 转换为 snake_case 以匹配元素 ID
                const snakeFieldName = fieldName.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
                const elementId = 'value-' + messageType + '-' + snakeFieldName;
                const valueEl = document.getElementById(elementId);
                if (valueEl) {
                    // 清空原有内容
                    valueEl.innerHTML = '';

                    // 创建值显示
                    const valueDiv = document.createElement('div');
                    valueDiv.className = 'field-value-received';
                    valueDiv.textContent = fieldInfo.display;
                    valueEl.appendChild(valueDiv);
                    
                    // 如果有描述，添加描述
                    if (fieldInfo.description) {
                        const descDiv = document.createElement('div');
                        descDiv.className = 'field-value-desc';
                        descDiv.textContent = '💡 ' + fieldInfo.description;
                        valueEl.appendChild(descDiv);
                    }
                    
                    // 添加时间戳
                    const timeDiv = document.createElement('div');
                    timeDiv.className = 'field-value-time';
                    timeDiv.textContent = new Date().toLocaleTimeString();
                    valueEl.appendChild(timeDiv);
                }
            }
        }
        
        // 刷新历史记录
        async function refreshHistory() {
            try {
                const response = await fetch('/api/uplink-history');
                const history = await response.json();
                
                const container = document.getElementById('historyPanel');
                
                if (!container) return; // 如果容器不存在则返回
                
                if (history.length === 0) {
                    container.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">暂无消息</p>';
                    return;
                }
                
                // 更新上行消息块中的最新数据
                const latestMessages = {};
                history.forEach(item => {
                    if (!latestMessages[item.messageType]) {
                        latestMessages[item.messageType] = item;
                    }
                });
                
                // 更新每个消息类型的最新接收数据
                for (const [messageType, item] of Object.entries(latestMessages)) {
                    if (item.parsedData) {
                        updateUplinkReceivedData(messageType, item.parsedData);
                    }
                }
                
                // 构建历史记录显示
                let html = '';
                history.forEach(item => {
                    // 构建解析后的数据显示
                    let dataDisplay = '';
                    if (item.parsedData && Object.keys(item.parsedData).length > 0) {
                        dataDisplay = '<div style="margin-top: 8px;">';
                        for (const [fieldName, fieldInfo] of Object.entries(item.parsedData)) {
                            dataDisplay += \`
                                <div class="field-display">
                                    <span class="field-display-name">\${fieldName}:</span>
                                    <span class="field-display-value">\${fieldInfo.display}</span>
                                    \${fieldInfo.description ? \`<div class="field-display-desc">💡 \${fieldInfo.description}</div>\` : ''}
                                </div>
                            \`;
                        }
                        dataDisplay += '</div>';
                    } else {
                        dataDisplay = \`<div class="history-data">\${JSON.stringify(item.data, null, 2)}</div>\`;
                    }
                    
                    html += \`
                        <div class="history-item">
                            <div class="history-header">
                                <div>
                                    <span class="history-type">\${item.messageType}</span>
                                    <span style="color: #999; font-size: 12px;">客户端: \${item.clientId}</span>
                                </div>
                                <span class="history-time">\${new Date(item.timestamp).toLocaleString('zh-CN')}</span>
                            </div>
                            \${dataDisplay}
                        </div>
                    \`;
                });
                
                container.innerHTML = html;
            } catch (error) {
                console.error('刷新历史记录失败:', error);
            }
        }
        
        // 切换消息展开/折叠
        function toggleMessage(element) {
            const wasActive = element.classList.contains('active');
            
            // 关闭同级所有展开的消息
            const parent = element.parentElement;
            parent.querySelectorAll('.message-item.active').forEach(item => {
                item.classList.remove('active');
            });
            
            // 如果之前不是展开状态，则展开
            if (!wasActive) {
                element.classList.add('active');
            }
        }
        
        // 初始化
        loadMessages();
        updateAutoStatus();
        
        // 定时刷新历史记录
        setInterval(refreshHistory, 2000);
    </script>
</body>
</html>`;
    }

    async start() {
        const loaded = await this.loadProto();
        if (!loaded) {
            throw new Error('Protobuf 加载失败，无法启动服务');
        }

        await this.startMQTT();
        this.startHTTP();
    }

    stop() {
        this.stopAutoPublish();
        
        if (this.mqttServer) {
            this.mqttServer.close(() => {
                console.log('⏹️ MQTT 服务已停止');
            });
        }

        if (this.httpServer) {
            this.httpServer.close(() => {
                console.log('⏹️ Web 服务已停止');
            });
        }

        if (aedes) {
            aedes.close(() => {
                console.log('⏹️ MQTT Broker 已关闭');
            });
        }
    }
}

module.exports = VisualMQTTServer;

// 如果直接运行此文件
if (require.main === module) {
    (async () => {
        const server = new VisualMQTTServer();
        try {
            await server.start();
        } catch (err) {
            console.error('❌ 启动失败:', err.message);
            process.exit(1);
        }
    })();
}
