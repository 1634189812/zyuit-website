# 项目约定与规则

## Git 提交规范（强制执行）
- **每次对网站文件做任何变更后，必须立即 commit + push 到 GitHub**
- Commit message 必须写清楚本次改了什么（中文），例如"联系我们排版优化 + 波司登拓扑图替换"
- 禁止累积多个变更后才提交
- 远程仓库：https://github.com/1634189812/zyuit-website.git（main 分支）
- 推送方式：HTTPS + token（SSH 在沙箱环境不通）

## 服务器部署
- 生产服务器：腾讯云 Lighthouse，IP 146.56.231.87，Ubuntu 22.04
- 网站目录：/home/ubuntu/zyuit-website/（Nginx root）
- Node 服务：PM2 管理，名称 yunkct-website，端口 3000，Nginx 反向代理 /api/ → localhost:3000
- 部署方式：Python paramiko + SSH 密钥认证（~/.ssh/id_ed25519_tencent），文件先传到 /tmp 再用 sudo cp 覆盖
- **SSH 安全**：已禁用密码登录，仅允许密钥认证；fail2ban 守护，3次失败封24小时
- PM2 重启：sudo pm2 restart yunkct-website（或 sudo pm2 restart all）
- 部署后自动调用 POST /api/update-notify 推送版本更新通知到企微群
