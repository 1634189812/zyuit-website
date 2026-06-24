/**
 * 云科网数官网 - 后端代理服务
 *
 * 用途：解决浏览器 CORS 限制，作为中间层代理转发企业微信 Webhook 请求。
 * 部署到腾讯云服务器后，将 index.html 中的 WX_WORKERS 改为 '/api/contact' 即可。
 *
 * 启动方式：
 *   1. 安装依赖：npm install express
 *   2. 启动服务：node server.js
 *   3. 默认端口 3000，可通过 PORT 环境变量修改
 *
 * 部署建议（腾讯云）：
 *   1. 上传整个 Ai/ 目录到服务器
 *   2. 安装 Node.js 和 npm
 *   3. cd Ai && npm install express && node server.js
 *   4. 配置 Nginx 反向代理（可选，推荐）
 */
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON body
app.use(express.json());

// WeChat webhook key (server-side, never exposed to browser)
const WX_KEY = '8d8dcf3c-8a04-4fc1-aede-d24f79f491fc';
const WX_WEBHOOK = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${WX_KEY}`;

// API proxy endpoint — POST /api/contact
app.post('/api/contact', async (req, res) => {
    try {
        const body = req.body;
        const time = body.time || new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        const name = body.name || '未填';
        const company = body.company || '未填';

        // Build news article description — markdown supported
        const desc = [
            `客户名称：**${body.name || '--'}**`,
            `职位：${body.position || '--'}`,
            `公司名称：**${body.company || '--'}**`,
            `联系电话：${body.phone || '--'}`,
            `电子邮箱：${body.email || '--'}`,
            `关注方向：${body.interest || '--'}`,
            ``,
            `**需求描述：**`,
            `> ${body.message || '无'}`,
        ].join('\n');

        const r = await fetch(WX_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                msgtype: 'news',
                news: {
                    articles: [{
                        title: `官网咨询 · ${name} · ${company}`,
                        description: desc,
                        url: 'https://www.yunkct.com',
                        picurl: 'https://www.yunkct.com/logo.png'
                    }]
                }
            })
        });

        const result = await r.json();
        if (result.errcode === 0) {
            res.json({ success: true });
        } else {
            console.error('WeChat webhook error:', result);
            res.status(502).json({ success: false, error: result.errmsg || 'Webhook rejected' });
        }
    } catch (err) {
        console.error('Proxy error:', err.message);
        res.status(502).json({ success: false, error: '服务器代理请求失败' });
    }
});

// Serve static files from current directory
app.use(express.static(path.join(__dirname)));

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Contact API: POST /api/contact`);
});

// 如果使用 PM2 管理进程：
//   npm install -g pm2
//   pm2 start server.js --name ykwsc-api
//   pm2 save && pm2 startup
