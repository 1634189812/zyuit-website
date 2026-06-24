/**
 * 云科网数官网 - 后端代理服务
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

const WX_KEY = '8d8dcf3c-8a04-4fc1-aede-d24f79f491fc';
const WX_WEBHOOK = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${WX_KEY}`;

// ========== User System ==========
const USERS = {
    admin: { password: 'admin@123', role: 'admin', name: '管理员' },
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

// 登录
app.post('/api/login', (req, res) => {
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

// 删除线索（仅管理员）
app.delete('/api/lead/:id', requireAuth, requireAdmin, (req, res) => {
    const idx = leads.findIndex(l => l.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Lead not found' });
    const removed = leads.splice(idx, 1)[0];
    saveLeads();
    console.log(`Lead deleted by admin: ${removed.id} — ${removed.name}`);
    res.json({ success: true, deleted: removed.id });
});

// ========== 表单提交 ==========
app.post('/api/contact', async (req, res) => {
    try {
        const body = req.body;
        const time = body.time || new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        const name = body.name || '未填';
        const company = body.company || '未填';
        const phone = body.phone || '--';
        const interest = body.interest || '未选择';
        const msgText = body.message || '无';

        const leadId = genId();
        const lead = {
            id: leadId,
            name,
            company,
            phone,
            position: body.position || '',
            email: body.email || '',
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
                    url: 'http://146.56.231.87/admin.html'
                },
                jump_list: [{
                    type: 1,
                    title: '查看线索管理后台',
                    url: 'http://146.56.231.87/admin.html'
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

// ========== 静态文件 ==========
app.use(express.static(path.join(__dirname)));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Contact API: POST /api/contact`);
    console.log(`Admin API:  GET /api/leads  |  PUT /api/lead/:id  |  DELETE /api/lead/:id`);
});
