"""Launch the native UI against a loopback-only fake account, never a real credential/service."""
import http.server
import json
import pathlib
import subprocess
import sys
import threading

requests = []
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def do_POST(self):
        self.reply()
    def do_GET(self):
        self.reply()
    def reply(self):
        requests.append((self.command, self.path))
        if self.headers.get('Content-Length'):
            self.rfile.read(int(self.headers['Content-Length']))
        if self.path == '/api/auth/desktop/token':
            data = dict(accessToken='fixture-access-not-a-real-token', refreshToken='fixture-refresh-not-a-real-token', expiresIn=3600,
                        refreshExpiresIn=86400, account=dict(email='fixture@example.invalid', username='fixture'))
        elif self.path == '/api/desktop/entitlement':
            data = dict(accountId=1, tier='ultimate', access=dict(hasAccess=True, source='tier'), tierGrantsAccess=True, canGenerate=True,
                        allowance=dict(remainingRon=10), wallet=dict(balanceRon=10, canGenerate=True),
                        models=[dict(modelKey='lfm2_5_230m_q4_k_m', label='LFM 2.5 230M', canGenerate=True, usesAllowance=True)])
        elif self.path == '/api/desktop/installer':
            data = dict(available=False)
        else:
            data = {}
        body = json.dumps(data).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)

root = pathlib.Path(__file__).resolve().parents[2]
app = sys.argv[1] if len(sys.argv) > 1 else 'playground-desktop/artifacts/bin/Filspresso.App/release_win-x64/Filspresso.Playground.exe'
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    subprocess.run(['powershell.exe', '-Sta', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(root / 'playground-desktop/tests/Smoke-UnifiedModes.ps1'),
                    '-AppPath', str(root / app), '-FixtureUrl', f'http://127.0.0.1:{server.server_port}/'], check=True, timeout=120)
    assert not any('agent/turn' in path or 'sandbox' in path or '/chat' in path for _, path in requests), requests
    print('PASS: mode selection made no inference, download or execution request.')
finally:
    server.shutdown(); server.server_close()
