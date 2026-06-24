/**
 * 云科网数官网 - 后端代理服务
 */
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

const WX_KEY = '8d8dcf3c-8a04-4fc1-aede-d24f79f491fc';
const WX_WEBHOOK = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${WX_KEY}`;

// Lead tracking — simple JSON file store
const LEADS_FILE = path.join(__dirname, 'leads.json');
let leads = {};
try { leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8')); } catch (_) {}

function saveLeads() { fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2)); }

// Status tracking endpoint
app.get('/api/lead/contacted', (req, res) => {
    const id = req.query.id;
    if (id && leads[id]) {
        leads[id].status = '已联系';
        leads[id].contactedAt = new Date().toISOString();
        saveLeads();
        console.log(`Lead ${id} marked as contacted`);
    }
    res.send(`<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>*{margin:0;padding:0;box-sizing:border-box}body{display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:-apple-system,"Microsoft YaHei",sans-serif;background:#f0f6ff;color:#1a5fb4}.card{text-align:center;padding:48px 32px;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(26,95,180,.12);max-width:360px;margin:16px}.icon{font-size:56px;margin-bottom:16px}.card h2{font-size:20px;margin-bottom:8px}.card p{color:#666;font-size:14px;margin-bottom:24px}.card a{display:inline-block;padding:10px 28px;background:#1a5fb4;color:#fff;border-radius:8px;text-decoration:none;font-size:14px}</style><div class="card"><div class="icon">\u2705</div><h2>已标记为「已联系」</h2><p>${leads[id] ? leads[id].name + ' · ' + leads[id].company : ''}</p><a href="javascript:window.close()">关闭页面</a></div>`);
});

app.get('/api/lead/done', (req, res) => {
    const id = req.query.id;
    if (id && leads[id]) {
        leads[id].status = '已完成';
        leads[id].doneAt = new Date().toISOString();
        saveLeads();
        console.log(`Lead ${id} marked as done`);
    }
    res.send(`<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>*{margin:0;padding:0;box-sizing:border-box}body{display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:-apple-system,"Microsoft YaHei",sans-serif;background:#f0fff0;color:#2a7d2a}.card{text-align:center;padding:48px 32px;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(42,125,42,.12);max-width:360px;margin:16px}.icon{font-size:56px;margin-bottom:16px}.card h2{font-size:20px;margin-bottom:8px}.card p{color:#666;font-size:14px;margin-bottom:24px}.card a{display:inline-block;padding:10px 28px;background:#2a7d2a;color:#fff;border-radius:8px;text-decoration:none;font-size:14px}</style><div class="card"><div class="icon">\u2705</div><h2>已标记为「已完成」</h2><p>${leads[id] ? leads[id].name + ' · ' + leads[id].company : ''}</p><a href="javascript:window.close()">关闭页面</a></div>`);
});

// API proxy endpoint — POST /api/contact
app.post('/api/contact', async (req, res) => {
    try {
        const body = req.body;
        const time = body.time || new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        const name = body.name || '未填';
        const company = body.company || '未填';
        const phone = body.phone || '--';
        const interest = body.interest || '未选择';
        const msgText = body.message || '无';
        // 需求首行作为 emphasis（最多10字），完整需求放字段列表
        const msgShort = msgText.length > 10 ? msgText.slice(0, 10) + '…' : msgText;

        // template_card — 简洁卡片，关注方向用普通字号，需求用正色
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
                    title: msgShort,
                    desc: '需求摘要'
                },
                horizontal_content_list: [
                    { keyname: '电话', value: phone },
                    { keyname: '职位', value: body.position || '--' },
                    { keyname: '邮箱', value: body.email || '--' },
                    { keyname: '关注方向', value: interest },
                    { keyname: '详细需求', value: msgText }
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
