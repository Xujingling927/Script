/**
 * Surge 仪表盘回显脚本
 */
const cache = $persistentStore.read("iwod_latest_cache");

if (!cache) {
    // 初始状态提示
    $done({
        title: "iWOD AI 助手",
        content: "暂无数据。请打开 iWOD 小程序查看 WOD 以触发分析。",
        icon: "lock.icloud",
        "icon-color": "#8E8E93"
    });
} else {
    const data = JSON.parse(cache);
    // 渲染面板内容
    $done({
        title: `今日 ${data.title}`,
        content: `【训练内容】\n${data.content}\n\n【AI 建议】\n${data.advice}\n\n更新于: ${data.updateTime}`,
        icon: "flame.fill",
        "icon-color": "#FF9500"
    });
}