/**
 * iWOD 自动捕获与分析脚本
 * 根据请求 URL 路由到不同的处理函数
 */

// 解析 URL 参数格式的字符串 (key1=value1&key2=value2)
function parseArguments(argStr) {
    const params = {};
    if (!argStr) return params;
    
    argStr.split('&').forEach(pair => {
        const [key, value] = pair.split('=');
        if (key && value) {
            params[key] = decodeURIComponent(value);
        }
    });
    return params;
}

const args = parseArguments($argument);
const TARGET_CLASS = args.TARGET_CLASS || "综合体能";
const AI_KEY = args.AI_API_KEY;
const AI_URL = args.AI_API_URL;
const AI_MODEL = args.AI_MODEL;
const TODAY = new Date().toDateString();

console.log(`🔧 解析到的参数: TARGET_CLASS="${TARGET_CLASS}", AI_KEY=${AI_KEY ? '已设置' : '未设置'}, AI_URL="${AI_URL}", AI_MODEL="${AI_MODEL}"`);

// 根据 URL 判断是哪个接口
if ($request.url.includes('/class/getTypes')) {
    handleClassTypes();
} else if ($request.url.includes('/everydayWod/getWodList')) {
    handleWodList();
} else {
    $done({});
}

/**
 * 处理课程类型接口
 * 捕获并保存 typeId 到课程名称的映射
 */
function handleClassTypes() {
    try {
        console.log("\n========== getTypes 接口处理开始 ==========");
        
        if (!$response.body) {
            console.log("❌ 响应体为空");
            return $done({});
        }
        
        console.log("📥 原始响应体前500字符: " + $response.body.substring(0, 500));
        const body = JSON.parse($response.body);
        console.log("✅ JSON 解析成功");
        
        // 处理可能的数据嵌套：body.data 或 body.data.data
        let typesData = null;
        if (body.data) {
            console.log(`🔍 body.data 类型: ${Array.isArray(body.data) ? '数组' : '对象'}`);
            if (Array.isArray(body.data)) {
                typesData = body.data;
                console.log(`✅ 数据位于 body.data，共 ${typesData.length} 条`);
            } else if (body.data.data && Array.isArray(body.data.data)) {
                typesData = body.data.data;
                console.log(`✅ 数据位于 body.data.data，共 ${typesData.length} 条`);
            }
        }
        
        if (!typesData) {
            console.log("❌ getTypes 响应数据格式异常，无法提取数据数组");
            return $done({});
        }
        
        console.log(`📋 前3条原始数据: ${JSON.stringify(typesData.slice(0, 3))}`);
        
        // 构建 typeId -> 课程名称 的映射
        const mapping = {};
        typesData.forEach((type, index) => {
            if (type.id && (type.name || type.showName)) {
                mapping[type.id] = type.showName || type.name;
                if (index < 3) {
                    console.log(`  课程${index + 1}: id=${type.id}, name="${type.name}", showName="${type.showName}"`);
                }
            }
        });
        
        // 保存到持久化存储
        $persistentStore.write(JSON.stringify(mapping), "iwod_type_mapping");
        console.log(`\n📚 已更新课程类型映射，共 ${Object.keys(mapping).length} 个类型`);
        console.log(`📝 完整映射内容:\n${JSON.stringify(mapping, null, 2)}`);
        console.log("========== getTypes 接口处理结束 ==========\n");
        
    } catch (e) {
        console.log("❌ 处理课程类型数据失败: " + e);
        console.log("错误堆栈: " + (e.stack || '无'));
    }
    $done({});
}

/**
 * 处理训练列表接口
 * 根据映射关系查找目标课程并进行 AI 分析
 */
async function handleWodList() {
    try {
        console.log("\n========== getWodList 接口处理开始 ==========");
        console.log(`🔑 AI参数: KEY=${AI_KEY ? '已设置' : '未设置'}, URL=${AI_URL}, MODEL=${AI_MODEL}`);
        
        // 1. 解析响应体
        if (!$response.body) {
            console.log("❌ 响应体为空");
            return $done({});
        }
        
        console.log("📥 原始响应体前500字符: " + $response.body.substring(0, 500));
        const body = JSON.parse($response.body);
        console.log("✅ JSON 解析成功");
        
        // 数据嵌套在 body.data.data 中
        if (!body.data || !body.data.data || !Array.isArray(body.data.data)) {
            console.log("❌ 响应数据格式异常");
            console.log(`  body.data 存在: ${!!body.data}`);
            console.log(`  body.data.data 存在: ${!!(body.data && body.data.data)}`);
            console.log(`  body.data.data 是数组: ${!!(body.data && body.data.data && Array.isArray(body.data.data))}`);
            return $done({});
        }
        
        console.log(`📊 训练列表共 ${body.data.data.length} 条记录`);

        // 2. 读取课程类型映射
        const mappingStr = $persistentStore.read("iwod_type_mapping");
        if (!mappingStr) {
            console.log("❌ 未找到课程类型映射，请先访问课程列表页面");
            return $done({});
        }
        
        console.log(`📖 读取到的映射: ${mappingStr}`);
        const typeMapping = JSON.parse(mappingStr);
        console.log(`✅ 映射解析成功，共 ${Object.keys(typeMapping).length} 个课程类型`);

        // 3. 查找"综合体能"的 classType ID
        console.log(`🎯 目标课程名称: "${TARGET_CLASS}"`);
        const targetTypeId = Object.keys(typeMapping).find(id => 
            typeMapping[id].includes(TARGET_CLASS)
        );
        
        if (!targetTypeId) {
            console.log(`❌ 未找到包含 "${TARGET_CLASS}" 的课程类型`);
            console.log(`  可用课程: ${Object.values(typeMapping).join(', ')}`);
            return $done({});
        }

        console.log(`✅ 目标课程: ${typeMapping[targetTypeId]} (classType: ${targetTypeId})`);

        // 4. 获取今天的日期（格式：2026.01.14）
        const today = new Date();
        const todayStr = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;
        console.log(`📅 查找日期: ${todayStr}`);
        console.log(`🔍 查找课程类型 ID: ${targetTypeId}`);

        // 打印所有课程详情
        console.log(`\n📋 今日所有课程详情:`);
        body.data.data.forEach((item, index) => {
            console.log(`  ${index + 1}. time="${item.time}", classType=${item.classType}, id=${item.id}`);
            if (index < 3 && item.detail && item.detail[0]) {
                console.log(`     内容预览: ${item.detail[0].detail.substring(0, 50)}...`);
            }
        });

        // 5. 查找今天的目标课程（支持模糊匹配日期，因为有些包含时间戳）
        console.log(`\n🔎 开始匹配: 日期包含"${todayStr}" 且 classType=${targetTypeId}`);
        const targetWod = body.data.data.find(item => {
            const timeMatch = item.time && item.time.startsWith(todayStr);
            const typeMatch = String(item.classType) === String(targetTypeId);
            console.log(`  检查记录: time="${item.time}" (匹配:${timeMatch}), classType=${item.classType} (匹配:${typeMatch})`);
            return timeMatch && typeMatch;
        });
        
        if (!targetWod) {
            console.log(`\n❌ 今日 (${todayStr}) 暂无 "${TARGET_CLASS}" 课程`);
            console.log("========== getWodList 接口处理结束 ==========\n");
            return $done({});
        }
        
        console.log(`\n✅ 找到目标课程! id=${targetWod.id}`);

        // 6. 提取训练内容
        if (!targetWod.detail || !Array.isArray(targetWod.detail) || targetWod.detail.length === 0) {
            console.log("⚠️ 训练详情为空");
            return $done({});
        }

        const wodContent = targetWod.detail[0].detail;
        if (!wodContent) {
            console.log("⚠️ 训练内容为空");
            return $done({});
        }

        // 7. 幂等检查：避免同一天重复请求 AI
        const cacheDate = $persistentStore.read("iwod_last_date");
        if (cacheDate === TODAY) {
            console.log("今日已完成分析，跳过 AI 请求");
            return $done({});
        }

        console.log("🚀 发现今日 WOD，开始 AI 分析...");

        // 8. 带超时的 AI 请求（最多等待 10 秒）
        try {
            const advice = await Promise.race([
                fetchAIAdvice(typeMapping[targetTypeId], wodContent, AI_KEY, AI_URL, AI_MODEL),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('AI 请求超时')), 10000)
                )
            ]);

            // 9. 保存 AI 分析结果
            const finalData = {
                title: typeMapping[targetTypeId],
                content: wodContent,
                advice: advice,
                updateTime: new Date().toLocaleString()
            };
            $persistentStore.write(JSON.stringify(finalData), "iwod_latest_cache");
            $persistentStore.write(TODAY, "iwod_last_date");

            // 10. 发送系统通知
            $notification.post(`iWOD - ${TARGET_CLASS}建议`, typeMapping[targetTypeId], advice);
            console.log("✅ AI 分析完成并已保存");

        } catch (aiError) {
            console.log(`⚠️ AI 分析失败或超时: ${aiError.message || aiError}`);
            
            // 保存降级数据
            const fallbackData = {
                title: typeMapping[targetTypeId],
                content: wodContent,
                advice: "AI 分析超时或失败，请稍后查看面板重试。",
                updateTime: new Date().toLocaleString()
            };
            $persistentStore.write(JSON.stringify(fallbackData), "iwod_latest_cache");
            $persistentStore.write(TODAY, "iwod_last_date");
            
            $notification.post(`iWOD - ${TARGET_CLASS}`, typeMapping[targetTypeId], "AI 分析失败，已保存训练内容");
        }

    } catch (e) {
        console.log("iWOD 助手处理出错: " + e);
    }
    $done({});
}

async function fetchAIAdvice(title, content, apiKey, apiUrl, apiModel) {
    const prompt = `你是一位专业的 CrossFit 教练。请分析以下训练内容并给出简洁的建议（不超过300字）：

【训练课程】${title}

【训练内容】
${content}

请从以下角度简要分析：
1. 训练重点和目标肌群
2. 技术要点和注意事项
3. 强度建议（适合初/中/高级）

要求：精炼专业，直接给出建议，不超过300字。`;
    
    // 判断是 Gemini 还是 OpenAI API
    const isGemini = apiUrl.includes('generativelanguage.googleapis.com');
    
    console.log(`🤖 使用 AI 服务: ${isGemini ? 'Google Gemini' : 'OpenAI 兼容接口'}`);
    
    return new Promise((resolve, reject) => {
        let requestConfig;
        
        if (isGemini) {
            // Google Gemini API 格式
            const geminiUrl = `${apiUrl}/models/${apiModel}:generateContent?key=${apiKey}`;
            requestConfig = {
                url: geminiUrl,
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }],
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 500
                    }
                })
            };
        } else {
            // OpenAI 兼容格式 (OpenAI / DeepSeek / 其他)
            requestConfig = {
                url: apiUrl,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: apiModel,
                    messages: [
                        { role: "system", content: "你是一位精炼、专业的 CrossFit 教练。回复必须简洁，不超过300字。" },
                        { role: "user", content: prompt }
                    ],
                    temperature: 0.7,
                    max_tokens: 500
                })
            };
        }
        
        console.log(`📤 发送请求到: ${requestConfig.url.substring(0, 50)}...`);
        
        $httpClient.post(requestConfig, (err, resp, data) => {
            if (err) {
                console.log(`❌ API 请求失败: ${err}`);
                return reject(err);
            }
            
            try {
                const res = JSON.parse(data);
                let advice = null;
                
                if (isGemini) {
                    // 解析 Gemini 响应
                    if (res.candidates && res.candidates.length > 0 && 
                        res.candidates[0].content && res.candidates[0].content.parts && 
                        res.candidates[0].content.parts.length > 0) {
                        advice = res.candidates[0].content.parts[0].text.trim();
                    }
                } else {
                    // 解析 OpenAI 格式响应
                    if (res.choices && res.choices.length > 0 && res.choices[0].message) {
                        advice = res.choices[0].message.content.trim();
                    }
                }
                
                if (advice) {
                    console.log(`✅ AI 分析成功，建议长度: ${advice.length} 字符`);
                    resolve(advice);
                } else {
                    console.log(`❌ AI 未返回有效内容，响应: ${data.substring(0, 200)}`);
                    reject("AI 未返回有效内容");
                }
            } catch (e) {
                console.log(`❌ 解析 AI 响应失败: ${e}`);
                reject("解析 AI 响应失败: " + e);
            }
        });
    });
}