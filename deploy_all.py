"""
部署网站文件到服务器 + 更新Nginx配置 + 推送版本通知
"""
import paramiko
import os
import time
import json

HOST = '146.56.231.87'
REMOTE_BASE = '/home/ubuntu/zyuit-website'
LOCAL_BASE = r'C:\Users\56487\WorkBuddy\2026-06-22-09-55-50\Ai'
NGINX_CONF = '/etc/nginx/sites-available/zyuit'

FILES_TO_DEPLOY = [
    'index.html',
    'admin.html',
    'server.js',
]

UPDATE_SUMMARY = """安全加固：网站安全整改
1. Nginx 隐藏版本号 + 安全响应头(X-Frame-Options/X-Content-Type-Options/X-XSS-Protection/Referrer-Policy)
2. 后台管理员密码更换为强密码
3. 服务器系统安全补丁已更新"""

def main():
    key_path = os.path.expanduser('~/.ssh/id_ed25519_tencent')
    key = paramiko.Ed25519Key.from_private_key_file(key_path)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username='ubuntu', pkey=key, timeout=10, look_for_keys=False, allow_agent=False)
    print('Connected as ubuntu')

    # ==================== Step 0: Update Nginx HTML cache ====================
    # 查看当前 HTML 缓存配置
    stdin, stdout, stderr = client.exec_command(f'sudo grep -n "html\|expires\|Cache-Control" {NGINX_CONF}')
    print(f'  Current cache config:\n{stdout.read().decode().strip()}')

    # 备份配置
    stdin, stdout, stderr = client.exec_command(f'sudo cp {NGINX_CONF} {NGINX_CONF}.bak-$(date +%Y%m%d-%H%M%S)')
    err = stderr.read().decode().strip()
    if err:
        print(f'  Backup warning: {err[:100]}')

    # 检查是否已经是 no-cache
    stdin, stdout, stderr = client.exec_command(f'sudo grep "no-cache" {NGINX_CONF}')
    already_nocache = 'no-cache' in stdout.read().decode()

    if already_nocache:
        print('  HTML cache already set to no-cache, skipping modification')
    else:
        # 用 sed 替换 HTML 缓存 location 块：先删掉 expires 行，再修改 Cache-Control
        # 匹配 location ~* \.html\$ 块内的 expires 1h; 替换为 expires -1;
        sed_cmd = f"""sudo sed -i '/location ~\\* \\\\\\.html/,/try_files/{{
            s/expires 1h;/expires -1;/
            s/public, must-revalidate/no-cache, must-revalidate, proxy-revalidate/
        }}' {NGINX_CONF}"""
        stdin, stdout, stderr = client.exec_command(sed_cmd)
        err = stderr.read().decode().strip()
        if err:
            print(f'  Sed warning: {err[:200]}')

        # 验证修改结果
        stdin, stdout, stderr = client.exec_command(f'sudo grep -A3 "location ~\\* \\\\\\.html" {NGINX_CONF}')
        print(f'  HTML cache block after:\n{stdout.read().decode().strip()}')

    # 测试 nginx 配置
    stdin, stdout, stderr = client.exec_command('sudo nginx -t 2>&1')
    nginx_test = stdout.read().decode().strip() + '\n' + stderr.read().decode().strip()
    print(f'  Nginx config test: {nginx_test[:200]}')

    if 'successful' in nginx_test.lower() or 'syntax is ok' in nginx_test.lower():
        stdin, stdout, stderr = client.exec_command('sudo nginx -s reload 2>&1')
        print(f'  Nginx reloaded: {stdout.read().decode().strip()}')
    else:
        print('  Nginx config test FAILED! Rolling back...')
        # 回滚到最近的备份
        stdin, stdout, stderr = client.exec_command(f'sudo ls -t {NGINX_CONF}.bak-* | head -1')
        latest_bak = stdout.read().decode().strip()
        if latest_bak:
            stdin, stdout, stderr = client.exec_command(f'sudo cp {latest_bak} {NGINX_CONF}')
            client.exec_command('sudo nginx -s reload')
            print(f'  Rolled back to {latest_bak}')
        client.close()
        return

    # ==================== Step 1: Upload files ====================
    for fname in FILES_TO_DEPLOY:
        local_path = os.path.join(LOCAL_BASE, fname)
        temp_path = f'/tmp/{fname}'
        if not os.path.exists(local_path):
            print(f'  SKIP {fname} - not found')
            continue
        sftp = client.open_sftp()
        sftp.put(local_path, temp_path)
        sftp.close()
        print(f'  UPLOADED {fname} ({os.path.getsize(local_path)} bytes) -> {temp_path}')

    # ==================== Step 2: Move to web root ====================
    for fname in FILES_TO_DEPLOY:
        remote_path = os.path.join(REMOTE_BASE, fname).replace('\\', '/')
        stdin, stdout, stderr = client.exec_command(f'sudo cp /tmp/{fname} {remote_path}')
        out = stdout.read().decode().strip()
        err = stderr.read().decode().strip()
        if err:
            print(f'  ERR cp {fname}: {err[:200]}')
        else:
            print(f'  DEPLOYED {fname} -> {remote_path}')

    stdin, stdout, stderr = client.exec_command(f'sudo chown -R ubuntu:www-data {REMOTE_BASE}')
    err = stderr.read().decode().strip()
    if err:
        print(f'  Chown ERR: {err[:200]}')

    # ==================== Step 3: Restart PM2 ====================
    client.exec_command('sudo kill $(sudo lsof -ti:3000) 2>/dev/null; sleep 1')
    client.exec_command('sudo pm2 delete all 2>/dev/null; sudo pm2 kill 2>/dev/null; sleep 1')
    stdin, stdout, stderr = client.exec_command(f'cd {REMOTE_BASE} && sudo pm2 start server.js --name yunkct-website 2>&1')
    pm2_out = stdout.read().decode().strip()
    pm2_err = stderr.read().decode().strip()
    print(f'  PM2: {pm2_out[:200]}')
    if pm2_err:
        print(f'  PM2 ERR: {pm2_err[:200]}')

    time.sleep(3)

    # Verify
    stdin, stdout, stderr = client.exec_command('curl -s -o /dev/null -w "HTTP %{http_code}" http://localhost:3000/')
    http_status = stdout.read().decode().strip()
    print(f'  Website status: {http_status}')

    # ==================== Step 4: Cache verification ====================
    stdin, stdout, stderr = client.exec_command('curl -sI http://localhost/ | grep -i "cache-control\|expires\|etag"')
    print(f'  Response headers:\n{stdout.read().decode().strip()}')

    # ==================== Step 5: Update notification ====================
    payload = json.dumps({
        "summary": UPDATE_SUMMARY,
        "author": "张文龙",
        "token": "zyuit-deploy-2025"
    })
    notify_cmd = f"""curl -s -X POST http://localhost:3000/api/update-notify -H 'Content-Type: application/json' -d '{payload}'"""
    stdin, stdout, stderr = client.exec_command(notify_cmd)
    notify_result = stdout.read().decode().strip()
    print(f'  Notify: {notify_result}')

    # Save PM2 config
    client.exec_command(f'cd {REMOTE_BASE} && sudo pm2 save 2>/dev/null')

    # Cleanup
    for fname in FILES_TO_DEPLOY:
        client.exec_command(f'sudo rm -f /tmp/{fname}')

    client.close()
    print('\n===== Deploy complete! =====')

if __name__ == '__main__':
    main()
