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
        const phone = body.phone || '--';

        // template_card text_notice — 企业微信原生卡片，高级感拉满
        const payload = {
            msgtype: 'template_card',
            template_card: {
                card_type: 'text_notice',
                source: {
                    icon_url: 'https://wework.qpic.cn/wwpic/252813_jOfDHtcISzuodLa_1629280209/0',
                    desc: '云科网数 · 官网咨询',
                    desc_color: 2
                },
                main_title: {
                    title: `${name} ｜ ${company}`,
                    desc: time
                },
                emphasis_content: {
                    title: body.interest || '未选择',
                    desc: '关注方向'
                },
                quote_area: {
                    type: 0,
                    quote_text: body.message || '暂无具体需求描述'
                },
                horizontal_content_list: [
                    { keyname: '职位', value: body.position || '--' },
                    { keyname: '电话', value: phone },
                    { keyname: '邮箱', value: body.email || '--' }
                ],
                jump_list: [
                    { type: 1, title: '查看官网', url: 'https://www.yunkct.com' }
                ],
                card_action: {
                    type: 1,
                    url: 'https://www.yunkct.com'
                }
            }
        };

        const r = await fetch(WX_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
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
