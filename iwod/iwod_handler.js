/**
 * iWOD 自动捕获与分析脚本
 */
const AI_KEY = $argument.AI_API_KEY;
const AI_URL = $argument.AI_API_URL;
const AI_MODEL = $argument.AI_MODEL;
const TARGET_CLASS = "综合体能";
const TODAY = new Date().toDateString();

async function main() {
    try {
        // 1. 解析原始响应体
        if (!$response.body) return $done({});
        const body = JSON.parse($response.body);
        if (!body.data || !Array.isArray(body.data)) return $done({});

        // 2. 查找目标课程 (综合体能)
        const targetWod = body.data.find(item => item.title.includes(TARGET_CLASS));
        if (!targetWod) {
            console.log(`未找到包含 "${TARGET_CLASS}" 的课程`);
            return $done({});
        }

        // 3. 幂等检查：避免同一天重复请求 AI
        const cacheDate = $persistentStore.read("iwod_last_date");
        if (cacheDate === TODAY) {
            console.log("今日已完成分析，跳过 AI 请求");
            return $done({});
        }

        const cleanWod = targetWod.content.replace(/<[^>]+>/g, ''); // 清理 HTML 标签
        console.log("🚀 发现新 WOD，开始 AI 分析...");

        // 4. 请求 AI 接口
        const advice = await fetchAIAdvice(targetWod.title, cleanWod);

        // 5. 持久化存储分析结果供面板读取
        const finalData = {
            title: targetWod.title,
            content: cleanWod,
            advice: advice,
            updateTime: new Date().toLocaleString()
        };
        $persistentStore.write(JSON.stringify(finalData), "iwod_latest_cache");
        $persistentStore.write(TODAY, "iwod_last_date");

        // 6. 发送系统通知
        $notification.post(`iWOD - ${TARGET_CLASS}建议`, targetWod.title, advice);

    } catch (e) {
        console.log("iWOD 助手处理出错: " + e);
    }
    $done({});
}

async function fetchAIAdvice(title, content) {
    const prompt = `你是一名 CrossFit 专业教练。请根据以下训练内容给出建议：\n训练: ${title}\n内容: ${content}`;
    
    return new Promise((resolve, reject) => {
        $httpClient.post({
            url: AI_URL,
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${AI_KEY}`
            },
            body: JSON.stringify({
                model: AI_MODEL,
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

main();