/**
 * 云科网数官网 - 后端代理服务
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== 安全基础配置 ==========
app.use(express.json({ limit: '10kb' }));   // 限制请求体大小
app.disable('x-powered-by');                 // 隐藏 Express 标识

// ========== 简单速率限制 (内存) ==========
const rateLimitMap = new Map();  // { ip: { count, resetAt } }
function rateLimit(windowMs, max) {
    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress;
        const now = Date.now();
        let entry = rateLimitMap.get(ip);
        if (!entry || now > entry.resetAt) {
            entry = { count: 0, resetAt: now + windowMs };
            rateLimitMap.set(ip, entry);
        }
        entry.count++;
        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, max - entry.count));
        if (entry.count > max) {
            return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
        }
        next();
    };
}
// 清理过期条目
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap) {
        if (now > entry.resetAt) rateLimitMap.delete(ip);
    }
}, 60000);

// ========== 输入消毒 ==========
function sanitize(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[<>\"\'`]/g, '').slice(0, 500);
}

// ========== 敏感文件拦截 (必须在静态文件之前) ==========
const BLOCKED_PATHS = [
    '/leads.json', '/server.js', '/package.json', '/package-lock.json',
    '/.env', '/.git', '/node_modules'
];
app.use((req, res, next) => {
    const url = req.path.toLowerCase();
    for (const bp of BLOCKED_PATHS) {
        if (url.startsWith(bp) || url === bp) {
            return res.status(404).send('Not Found');
        }
    }
    // 拒绝常见的扫描探测路径
    if (/\.(php|asp|aspx|jsp|cgi|sql|bak|old|swp|env|git|svn)/.test(url)) {
        return res.status(404).send('Not Found');
    }
    next();
});

const WX_KEY = '8d8dcf3c-8a04-4fc1-aede-d24f79f491fc';
const WX_WEBHOOK = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${WX_KEY}`;

// 版本更新机器人
const WX_UPDATE_KEY = '9cd12585-50fd-4cc5-ae56-601ccf9a53a0';
const WX_UPDATE_WEBHOOK = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${WX_UPDATE_KEY}`;

// ========== User System ==========
const USERS = {
    admin: { password: 'Admin85@2007', role: 'admin', name: '管理员' },
    '01':   { password: 'admin@123', role: 'user',  name: '员工01' },
    '02':   { password: 'admin@123', role: 'user',  name: '员工02' }
};

const sessions = {}; // { token: { username, role, expires } }
const SESSION_TTL = 8 * 3600000; // 8小时

function createSession(username) {
    const token = crypto.randomBytes(16).toString('hex');
    sessions[token] = {
        username,
        role: USERS[username].role,
        name: USERS[username].name,
        expires: Date.now() + SESSION_TTL
    };
    return token;
}

function getSession(token) {
    const s = sessions[token];
    if (!s || s.expires < Date.now()) { delete sessions[token]; return null; }
    return s;
}

// Auth middleware
function requireAuth(req, res, next) {
    const token = req.query.token || req.headers['x-auth-token'];
    const session = getSession(token);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });
    req.session = session;
    next();
}

// Admin-only middleware
function requireAdmin(req, res, next) {
    if (req.session.role !== 'admin') return res.status(403).json({ error: '仅管理员可操作' });
    next();
}

// ========== Auth API ==========

// 登录 (速率限制: 5次/分钟/IP)
app.post('/api/login', rateLimit(60000, 5), (req, res) => {
    const { username, password } = req.body;
    const u = USERS[username];
    if (!u || u.password !== password) {
        return res.status(401).json({ error: '用户名或密码错误' });
    }
    const token = createSession(username);
    res.json({ token, role: u.role, name: u.name, username });
});

// 验证登录态
app.get('/api/session', requireAuth, (req, res) => {
    res.json({ username: req.session.username, role: req.session.role, name: req.session.name });
});

// 登出
app.post('/api/logout', requireAuth, (req, res) => {
    const token = req.query.token || req.headers['x-auth-token'];
    delete sessions[token];
    res.json({ success: true });
});

// ========== Lead Storage ==========
const LEADS_FILE = path.join(__dirname, 'leads.json');
let leads = [];
try {
    const raw = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
    if (!Array.isArray(raw)) {
        leads = Object.entries(raw).map(([id, data]) => ({ id, ...data }));
    } else {
        leads = raw;
    }
} catch (_) {}

function saveLeads() { fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2)); }

function genId() {
    const now = new Date();
    return 'LD' + String(now.getFullYear()).slice(2) +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') +
        crypto.randomBytes(2).toString('hex').toUpperCase();
}

// ========== Legacy 状态标记端点 ==========
app.get('/api/lead/contacted', (req, res) => {
    const id = req.query.id;
    const lead = leads.find(l => l.id === id);
    if (lead) {
        lead.status = '已联系';
        lead.contactedAt = new Date().toISOString();
        saveLeads();
    }
    res.send(`<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>*{margin:0;padding:0;box-sizing:border-box}body{display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:-apple-system,"Microsoft YaHei",sans-serif;background:#f0f6ff;color:#1a5fb4}.card{text-align:center;padding:48px 32px;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(26,95,180,.12);max-width:360px;margin:16px}.icon{font-size:56px;margin-bottom:16px}.card h2{font-size:20px;margin-bottom:8px}.card p{color:#666;font-size:14px;margin-bottom:24px}.card a{display:inline-block;padding:10px 28px;background:#1a5fb4;color:#fff;border-radius:8px;text-decoration:none;font-size:14px}</style><div class="card"><div class="icon">\u2705</div><h2>已标记为「已联系」</h2><p>${lead ? lead.name + ' · ' + lead.company : ''}</p><a href="javascript:window.close()">关闭页面</a></div>`);
});

app.get('/api/lead/done', (req, res) => {
    const id = req.query.id;
    const lead = leads.find(l => l.id === id);
    if (lead) {
        lead.status = '已完成';
        lead.doneAt = new Date().toISOString();
        saveLeads();
    }
    res.send(`<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>*{margin:0;padding:0;box-sizing:border-box}body{display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:-apple-system,"Microsoft YaHei",sans-serif;background:#f0fff0;color:#2a7d2a}.card{text-align:center;padding:48px 32px;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(42,125,42,.12);max-width:360px;margin:16px}.icon{font-size:56px;margin-bottom:16px}.card h2{font-size:20px;margin-bottom:8px}.card p{color:#666;font-size:14px;margin-bottom:24px}.card a{display:inline-block;padding:10px 28px;background:#2a7d2a;color:#fff;border-radius:8px;text-decoration:none;font-size:14px}</style><div class="card"><div class="icon">\u2705</div><h2>已标记为「已完成」</h2><p>${lead ? lead.name + ' · ' + lead.company : ''}</p><a href="javascript:window.close()">关闭页面</a></div>`);
});

// ========== Admin API (需登录) ==========

// 获取全部线索
app.get('/api/leads', requireAuth, (req, res) => {
    const sorted = [...leads].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json({ leads: sorted, role: req.session.role, name: req.session.name });
});

// 更新单条线索
app.put('/api/lead/:id', requireAuth, (req, res) => {
    const lead = leads.find(l => l.id === req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const { status, progress, notes } = req.body;
    if (status !== undefined) lead.status = status;
    if (progress !== undefined) lead.progress = progress;
    if (notes !== undefined) lead.notes = notes;
    lead.updatedAt = new Date().toISOString();
    lead.updatedBy = req.session.username;
    saveLeads();
    res.json({ success: true, lead });
});

// 批量删除线索（仅管理员）
app.post('/api/leads/batch-delete', requireAuth, requireAdmin, (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: '请提供要删除的线索ID列表' });
    }
    if (ids.length > 100) {
        return res.status(400).json({ error: '单次最多删除100条' });
    }
    const removed = [];
    leads = leads.filter(l => {
        if (ids.includes(l.id)) {
            removed.push(l.id);
            return false;
        }
        return true;
    });
    saveLeads();
    console.log(`Batch deleted by admin: ${removed.length} leads — ${removed.join(', ')}`);
    res.json({ success: true, deleted: removed.length, ids: removed });
});

// 删除线索（仅管理员）
app.delete('/api/lead/:id', requireAuth, requireAdmin, (req, res) => {
    const idx = leads.findIndex(l => l.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Lead not found' });
    const removed = leads.splice(idx, 1)[0];
    saveLeads();
    console.log(`Lead deleted by admin: ${removed.id} — ${removed.name}`);
    res.json({ success: true, deleted: removed.id });
});

// ========== 表单提交 (速率限制: 3次/分钟/IP) ==========
app.post('/api/contact', rateLimit(60000, 3), async (req, res) => {
    try {
        const body = req.body;
        const time = sanitize(body.time) || new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        const name = sanitize(body.name) || '未填';
        const company = sanitize(body.company) || '未填';
        const phone = sanitize(body.phone) || '--';
        const interest = sanitize(body.interest) || '未选择';
        const msgText = sanitize(body.message) || '无';

        const leadId = genId();
        const lead = {
            id: leadId,
            name,
            company,
            phone,
            position: sanitize(body.position) || '',
            email: sanitize(body.email) || '',
            interest,
            message: msgText,
            status: '待联系',
            progress: '',
            notes: '',
            createdAt: new Date().toISOString(),
            contactedAt: null,
            doneAt: null
        };
        leads.push(lead);
        saveLeads();
        console.log(`Lead saved: ${leadId} — ${name} (${company})`);

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
                horizontal_content_list: [
                    { keyname: '电话', value: phone },
                    { keyname: '职位', value: body.position || '--' },
                    { keyname: '邮箱', value: body.email || '--' },
                    { keyname: '关注方向', value: interest },
                    { keyname: '详细需求', value: msgText }
                ],
                card_action: {
                    type: 1,
                    url: 'https://yunkct.com/admin.html'
                },
                jump_list: [{
                    type: 1,
                    title: '查看线索管理后台',
                    url: 'https://yunkct.com/admin.html'
                }]
            }
        };

        const r = await fetch(WX_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await r.json();
        if (result.errcode === 0) {
            res.json({ success: true, leadId });
        } else {
            console.error('WeChat webhook error:', result);
            res.status(502).json({ success: false, error: result.errmsg || 'Webhook rejected' });
        }
    } catch (err) {
        console.error('Proxy error:', err.message);
        res.status(502).json({ success: false, error: '服务器代理请求失败' });
    }
});

// ========== 版本更新通知 (部署后触发) ==========
const DEPLOY_TOKEN = 'zyuit-deploy-2025';

app.post('/api/update-notify', (req, res) => {
    // 验证部署令牌
    const token = req.headers['x-deploy-token'] || req.body.token;
    if (token !== DEPLOY_TOKEN) {
        return res.status(403).json({ error: 'Invalid deploy token' });
    }

    const { version, summary, details, author } = req.body;

    if (!summary) {
        return res.status(400).json({ error: '缺少更新摘要 (summary)' });
    }

    const now = new Date();
    const timeStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const ver = version || `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;

    // 构建更新说明
    let content = `##  云科网数官网 · 版本更新\n`;
    content += `> 版本号：<font color=\"info\">${ver}</font>\n`;
    content += `> 更新时间：${timeStr}\n`;
    if (author) content += `> 操作人：${author}\n`;
    content += `\n**更新内容：**\n${summary}\n`;
    if (details) {
        content += `\n**详细说明：**\n${details}\n`;
    }
    content += `\n[查看网站 →](https://yunkct.com)`;

    const payload = {
        msgtype: 'markdown',
        markdown: { content }
    };

    fetch(WX_UPDATE_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).then(r => r.json()).then(result => {
        if (result.errcode === 0) {
            console.log(`Update notification sent: ${ver}`);
            res.json({ success: true, version: ver });
        } else {
            console.error('Update webhook error:', result);
            res.status(502).json({ success: false, error: result.errmsg || 'Webhook rejected' });
        }
    }).catch(err => {
        console.error('Update notify error:', err.message);
        res.status(502).json({ success: false, error: '推送失败' });
    });
});

// ========== 静态文件 ==========
app.use(express.static(path.join(__dirname)));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Contact API: POST /api/contact`);
    console.log(`Admin API:  GET /api/leads  |  PUT /api/lead/:id  |  DELETE /api/lead/:id  |  POST /api/leads/batch-delete`);
});
