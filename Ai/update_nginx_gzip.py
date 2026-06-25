#!/usr/bin/env python3
"""Update nginx gzip config on remote server"""
import paramiko, re

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('146.56.231.87', username='ubuntu', password='Admin85@2007')

# Read current config
stdin, stdout, stderr = client.exec_command('cat /etc/nginx/nginx.conf')
content = stdout.read().decode()

# Build new gzip block
gzip_block = """        ##
        # Gzip Settings
        ##

        gzip on;
        gzip_vary on;
        gzip_proxied any;
        gzip_comp_level 6;
        gzip_buffers 16 8k;
        gzip_http_version 1.1;
        gzip_min_length 256;
        gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml application/xml+rss image/svg+xml;

"""

# Replace entire gzip section (from ## Gzip Settings ## to ## Virtual Host Configs ##)
new_content = re.sub(
    r'##\s*\n\s*# Gzip Settings\s*\n\s*##.*?##\s*\n\s*# Virtual Host Configs',
    gzip_block + '        ##\n        # Virtual Host Configs',
    content,
    flags=re.DOTALL
)

if new_content == content:
    print('WARNING: regex did not match, trying simpler replace')
    # Fallback: just uncomment the relevant lines
    new_content = content.replace('        # gzip_vary on;', '        gzip_vary on;')
    new_content = new_content.replace('        # gzip_proxied any;', '        gzip_proxied any;')
    new_content = new_content.replace('        # gzip_comp_level 6;', '        gzip_comp_level 6;')
    new_content = new_content.replace('        # gzip_buffers 16 8k;', '        gzip_buffers 16 8k;')
    new_content = new_content.replace('        # gzip_http_version 1.1;', '        gzip_http_version 1.1;')
    new_content = new_content.replace(
        '        # gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;',
        '        gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml;\n        gzip_min_length 256;\n        gzip_vary on;\n        gzip_proxied any;\n        gzip_comp_level 6;'
    )
    print('Fallback replace applied')

# Write to temp file
with open('/tmp/nginx_new.conf', 'w') as f:
    f.write(new_content)

# Upload via SFTP
sftp = client.open_sftp()
sftp.put('/tmp/nginx_new.conf', '/tmp/nginx_new.conf')
sftp.close()

# Backup + apply + test + reload
stdin, stdout, stderr = client.exec_command(
    'sudo cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak && '
    'sudo cp /tmp/nginx_new.conf /etc/nginx/nginx.conf && '
    'sudo nginx -t 2>&1'
)
result = stdout.read().decode() + stderr.read().decode()
print('TEST:', result)

if 'successful' in result or 'ok' in result:
    stdin2, stdout2, stderr2 = client.exec_command('sudo nginx -s reload 2>&1')
    print('RELOAD:', stdout2.read().decode(), stderr2.read().decode())
    print('SUCCESS')
else:
    # Rollback
    stdin3, stdout3, stderr3 = client.exec_command('sudo cp /etc/nginx/nginx.conf.bak /etc/nginx/nginx.conf 2>&1')
    print('ROLLBACK:', stdout3.read().decode())
    print('FAILED - rolled back')

# Verify gzip lines
stdin4, stdout4, stderr4 = client.exec_command('grep -n "gzip" /etc/nginx/nginx.conf | head -20')
print('GZIP LINES:', stdout4.read().decode())

client.close()
