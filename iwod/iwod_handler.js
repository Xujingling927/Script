/**
 * iWOD 自动捕获与分析脚本
 * 根据请求 URL 路由到不同的处理函数
 */
const TARGET_CLASS = $argument.TARGET_CLASS || "综合体能";
const TODAY = new Date().toDateString();

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
        if (!$response.body) return $done({});
        const body = JSON.parse($response.body);
        
        if (!body.data || !Array.isArray(body.data)) {
            return $done({});
        }
        
        // 构建 typeId -> 课程名称 的映射
        const mapping = {};
        body.data.forEach(type => {
            if (type.id && type.title) {
                mapping[type.id] = type.title;
            }
        });
        
        // 保存到持久化存储
        $persistentStore.write(JSON.stringify(mapping), "iwod_type_mapping");
        console.log(`📚 已更新课程类型映射，共 ${Object.keys(mapping).length} 个类型`);
        
    } catch (e) {
        console.log("处理课程类型数据失败: " + e);
    }
    $done({});
}

/**
 * 处理训练列表接口
 * 根据映射关系查找目标课程并进行 AI 分析
 */
async function handleWodList() {
    try {
        const AI_KEY = $argument.AI_API_KEY;
        const AI_URL = $argument.AI_API_URL;
        const AI_MODEL = $argument.AI_MODEL;
        
        // 1. 解析响应体
        if (!$response.body) return $done({});
        const body = JSON.parse($response.body);
        if (!body.data || !Array.isArray(body.data)) return $done({});

        // 2. 读取课程类型映射
        const mappingStr = $persistentStore.read("iwod_type_mapping");
        if (!mappingStr) {
            console.log("⚠️ 未找到课程类型映射，请先访问课程列表页面");
            return $done({});
        }
        
        const typeMapping = JSON.parse(mappingStr);

        // 3. 查找"综合体能"的 typeId
        const targetTypeId = Object.keys(typeMapping).find(id => 
            typeMapping[id].includes(TARGET_CLASS)
        );
        
        if (!targetTypeId) {
            console.log(`未找到包含 "${TARGET_CLASS}" 的课程类型`);
            return $done({});
        }

        console.log(`✅ 目标课程: ${typeMapping[targetTypeId]} (typeId: ${targetTypeId})`);

        // 4. 在 WOD 列表中查找匹配的课程
        const targetWod = body.data.find(item => String(item.typeId) === String(targetTypeId));
        if (!targetWod) {
            console.log(`今日暂无 "${TARGET_CLASS}" 课程`);
            return $done({});
        }

        // 5. 幂等检查：避免同一天重复请求 AI
        const cacheDate = $persistentStore.read("iwod_last_date");
        if (cacheDate === TODAY) {
            console.log("今日已完成分析，跳过 AI 请求");
            return $done({});
        }

        const cleanWod = targetWod.content.replace(/<[^>]+>/g, ''); // 清理 HTML 标签
        console.log("🚀 发现新 WOD，开始 AI 分析...");

        // 6. 请求 AI 接口
        const advice = await fetchAIAdvice(typeMapping[targetTypeId], cleanWod, AI_KEY, AI_URL, AI_MODEL);

        // 7. 持久化存储分析结果供面板读取
        const finalData = {
            title: typeMapping[targetTypeId],
            content: cleanWod,
            advice: advice,
            updateTime: new Date().toLocaleString()
        };
        $persistentStore.write(JSON.stringify(finalData), "iwod_latest_cache");
        $persistentStore.write(TODAY, "iwod_last_date");

        // 8. 发送系统通知
        $notification.post(`iWOD - ${TARGET_CLASS}建议`, typeMapping[targetTypeId], advice);

    } catch (e) {
        console.log("iWOD 助手处理出错: " + e);
    }
    $done({});
}

async function fetchAIAdvice(title, content, apiKey, apiUrl, apiModel) {
    const prompt = `你是一名 CrossFit 专业教练。请根据以下训练内容给出建议：\n训练: ${title}\n内容: ${content}`;
    
    return new Promise((resolve, reject) => {
        $httpClient.post({
            url: apiUrl,
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: apiModel,
                messages: [
                    { role: "system", content: "你是一位精炼、专业的健身助手。" },
                    { role: "user", content: prompt }
                ]
            })
        }, (err, resp, data) => {
            if (err) return reject(err);
            const res = JSON.parse(data);
            if (res.choices && res.choices.length > 0) {
                resolve(res.choices[0].message.content.trim());
            } else {
                reject("AI 未返回有效内容");
            }
        });
    });
}