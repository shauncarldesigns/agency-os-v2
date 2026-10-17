#!/usr/bin/env python3
"""Build and install a fixed-command, per-user macOS Signalhouse URL launcher."""
import argparse
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project', type=Path, required=True)
parser.add_argument('--node', type=Path, required=True)
args = parser.parse_args()
project = args.project.expanduser().resolve()
node = args.node.expanduser().resolve()
next_cli = project / 'node_modules/next/dist/bin/next'
if not next_cli.is_file() or not node.is_file():
    parser.error('Provide an existing Signalhouse checkout with dependencies and a Node executable.')
subprocess.run([str(node), '-e', 'if (+process.versions.node.split(".")[0] < 22) process.exit(1)'], check=True)

home = Path.home()
app = home / 'Applications/Signalhouse Launcher.app'
label = 'com.shauncarldesigns.signalhouse.server'
agent = home / f'Library/LaunchAgents/{label}.plist'
logs = home / 'Library/Logs/Signalhouse'
info = {
    'CFBundleExecutable': 'SignalhouseLauncher',
    'CFBundleIdentifier': 'com.shauncarldesigns.signalhouse.launcher',
    'CFBundleName': 'Signalhouse Launcher',
    'CFBundlePackageType': 'APPL',
    'CFBundleVersion': '1',
    'CFBundleShortVersionString': '1.0',
    'LSUIElement': True,
    'NSAppTransportSecurity': {'NSAllowsLocalNetworking': True},
    'CFBundleURLTypes': [{'CFBundleURLName': 'Signalhouse local workspace', 'CFBundleURLSchemes': ['signalhouse'], 'CFBundleTypeRole': 'Viewer'}],
}
agent_config = {
    'Label': label,
    'ProgramArguments': [str(node), str(next_cli), 'dev', '--hostname', '127.0.0.1', '--port', '3000'],
    'WorkingDirectory': str(project),
    'RunAtLoad': False,
    'KeepAlive': False,
    'ProcessType': 'Interactive',
    'EnvironmentVariables': {'PATH': f'{node.parent}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', 'NEXT_TELEMETRY_DISABLED': '1'},
    'StandardOutPath': str(logs / 'server.log'),
    'StandardErrorPath': str(logs / 'server.log'),
}
# Compile before touching the installed launcher or service.
with tempfile.TemporaryDirectory(prefix='signalhouse-launcher-') as temporary:
    staged = Path(temporary) / app.name
    executable = staged / 'Contents/MacOS/SignalhouseLauncher'
    executable.parent.mkdir(parents=True)
    sdk = subprocess.check_output(['/usr/bin/xcrun', '--show-sdk-path'], text=True).strip()
    clang_resources = subprocess.check_output(['/usr/bin/clang', '-print-resource-dir'], text=True).strip()
    # Avoid shell-injected local headers shadowing Apple's SDK.
    compiler_env = os.environ.copy()
    for key in ('CPATH', 'C_INCLUDE_PATH', 'CPLUS_INCLUDE_PATH', 'OBJC_INCLUDE_PATH'):
        compiler_env.pop(key, None)
    result = subprocess.run(['/usr/bin/clang', '-O2', '-fobjc-arc', '-fno-modules', '-nostdinc',
        '-isystem', f'{clang_resources}/include', '-isystem', f'{sdk}/usr/include',
        f'-F{sdk}/System/Library/Frameworks', '-isysroot', sdk,
        str(Path(__file__).with_name('Launcher.m')), '-o', str(executable), '-framework', 'Cocoa'], capture_output=True, text=True, env=compiler_env)
    if result.returncode:
        log = Path(tempfile.gettempdir()) / 'signalhouse-launcher-build.log'
        log.write_text(result.stdout + result.stderr)
        errors = [line for line in result.stderr.splitlines() if 'error:' in line][:8]
        raise SystemExit('Launcher compilation failed: ' + '\n'.join(errors) + f'\nFull log: {log}')
    with (staged / 'Contents/Info.plist').open('wb') as file:
        plistlib.dump(info, file)
    subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-', str(staged)], check=True)
    app.parent.mkdir(parents=True, exist_ok=True)
    if app.exists():
        parser.error(f'{app} already exists; refusing to replace it automatically.')
    if agent.exists():
        parser.error(f'{agent} already exists; refusing to replace it automatically.')
    logs.mkdir(parents=True, exist_ok=True)
    agent.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(staged, app)
    with agent.open('wb') as file:
        plistlib.dump(agent_config, file)
    agent.chmod(0o600)

subprocess.run(['/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', '-f', str(app)], check=True)
subprocess.run(['/bin/launchctl', 'bootstrap', f'gui/{os.getuid()}', str(agent)], check=True)
print(f'Installed {app}')
print('Open signalhouse://open to start the local workspace. The server does not start at login.')
